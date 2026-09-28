import {
  inAssociationOrder,
  linkOf,
  scopedTarget,
  type AssociationDefinition,
} from "./associations.ts";
import type { CompiledSql } from "./compiler.ts";
import { DeleteRestriction, RecordNotDestroyed } from "./errors.ts";
import { prepareDestroy } from "./lifecycle.ts";
import type { ModelBase, ModelClass } from "./model.ts";
import { state } from "./record-state.ts";
import type { Scoped } from "./relation.ts";
import { statementParts, type Statement } from "./statement.ts";
import { statementWrite, type PreparedWrite } from "./unit-of-work.ts";

/** What an owner's `dependent:` associations add to its destroy, or why they refuse it. */
export type DependentsPlan = { writes: PreparedWrite[] } | { status: "restricted"; reason: string };

type Dependency = [name: string, definition: AssociationDefinition];

/**
 * Prepares the owner's `dependent:` strategies, in the contract's order: restrictions first, so
 * a restricted owner touches nothing; then each `destroy` record's own prepared destroy (its
 * callbacks and dependents); then the `deleteAll`/`delete`/`nullify` statements. The caller
 * writes all of it in one batch with the owner's DELETE.
 */
export async function prepareDependents(owner: ModelBase): Promise<DependentsPlan> {
  const model = owner.constructor as ModelClass;
  const dependencies = Object.entries(model.associations).filter(
    ([, definition]) => definition.dependent !== undefined,
  );
  for (const dependency of dependencies) {
    const reason = await checkRestriction(owner, dependency);
    if (reason !== undefined) return { status: "restricted", reason };
  }
  const writes: PreparedWrite[] = [];
  for (const dependency of dependencies) writes.push(...(await destroyRecords(owner, dependency)));
  const statements = dependencies.flatMap((dependency) => statementFor(owner, dependency));
  return { writes: [...writes, statementWrite(statements)] };
}

/** The association's records for this owner (a hasOne's first one only), with its scope. */
function recordsOf(owner: ModelBase, [name, definition]: Dependency): Scoped<ModelBase> {
  const model = owner.constructor as ModelClass;
  const target = definition.target();
  const { ownerAttribute, targetAttribute } = linkOf(definition, model, target);
  const records = scopedTarget(owner[state].executor, model, name, definition).where({
    [targetAttribute]: owner[state].read(ownerAttribute),
  });
  return definition.kind === "hasOne" ? inAssociationOrder(records, target).limit(1) : records;
}

/** Why a restrict strategy refuses the destroy, if it does (Rails' wording). */
async function checkRestriction(
  owner: ModelBase,
  dependency: Dependency,
): Promise<string | undefined> {
  const [name, { dependent, kind }] = dependency;
  if (dependent !== "restrictWithException" && dependent !== "restrictWithError") return undefined;
  if (!(await recordsOf(owner, dependency).exists())) return undefined;
  if (dependent === "restrictWithException") {
    throw new DeleteRestriction(`Cannot delete record because of dependent ${name}`);
  }
  const message =
    kind === "hasOne"
      ? `Cannot delete record because a dependent ${name} exists`
      : `Cannot delete record because dependent ${name} exist`;
  owner.errors.add("base", message, { type: "restrictDependentDestroy" });
  return message;
}

/**
 * `destroy`: each record's prepared destroy, callbacks and dependents included. A record that
 * refuses stops the owner's destroy before anything is written.
 */
async function destroyRecords(owner: ModelBase, dependency: Dependency): Promise<PreparedWrite[]> {
  if (dependency[1].dependent !== "destroy") return [];
  const writes: PreparedWrite[] = [];
  for (const record of await recordsOf(owner, dependency).toArray()) {
    const plan = await prepareDestroy(record);
    if (plan.status !== "ready") {
      throw new RecordNotDestroyed("reason" in plan ? plan.reason : "");
    }
    writes.push(...plan.writes);
  }
  return writes;
}

/** The statement for `deleteAll`, `delete` or `nullify`, if that's the strategy. */
function statementFor(owner: ModelBase, dependency: Dependency): CompiledSql[] {
  const { dependent, foreignKey } = dependency[1];
  let statement: Statement;
  if (dependent === "deleteAll" || dependent === "delete") {
    statement = recordsOf(owner, dependency).deleteAll();
  } else if (dependent === "nullify") {
    // The foreign key was checked as a target attribute when the Model was prepared.
    statement = recordsOf(owner, dependency).updateAll({ [foreignKey]: null } as never);
  } else {
    return [];
  }
  return [statement[statementParts].query];
}
