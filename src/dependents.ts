import {
  inAssociationOrder,
  linkOf,
  scopedTarget,
  type AssociationDefinition,
} from "./associations.ts";
import type { CompiledSql } from "./compiler.ts";
import { DeleteRestriction } from "./errors.ts";
import type { ModelBase, ModelClass } from "./model.ts";
import { state } from "./record-state.ts";
import type { Scoped } from "./relation.ts";
import { statementParts, type Statement } from "./statement.ts";

/** What an owner's `dependent:` associations need before its DELETE. */
export type DependentsOutcome =
  | { status: "ready"; statements: CompiledSql[] }
  | { status: "restricted"; reason: string };

type Dependency = [name: string, definition: AssociationDefinition];

/**
 * Runs the owner's `dependent:` strategies, in the contract's order: restrictions first, so a
 * restricted owner touches nothing; then `destroy`, each record's full destroy lifecycle (not
 * atomic); then the `deleteAll`/`delete`/`nullify` statements, returned for the caller to send
 * in one batch with the owner's DELETE.
 */
export async function runDependents(owner: ModelBase): Promise<DependentsOutcome> {
  const model = owner.constructor as ModelClass;
  const dependencies = Object.entries(model.associations).filter(
    ([, definition]) => definition.dependent !== undefined,
  );
  for (const dependency of dependencies) {
    const reason = await checkRestriction(owner, dependency);
    if (reason !== undefined) return { status: "restricted", reason };
  }
  for (const dependency of dependencies) await destroyRecords(owner, dependency);
  const statements = dependencies.flatMap((dependency) => statementFor(owner, dependency));
  return { status: "ready", statements };
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

/** `destroy`: each record's destroy lifecycle; an abort stops the owner's destroy. */
async function destroyRecords(owner: ModelBase, dependency: Dependency): Promise<void> {
  if (dependency[1].dependent !== "destroy") return;
  for (const record of await recordsOf(owner, dependency).toArray()) {
    await record.destroyOrThrow();
  }
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
