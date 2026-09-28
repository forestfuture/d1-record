import { compileDelete, compileInsert, compileSelect, compileUpdate } from "./compiler.ts";
import { prepareDependents } from "./dependents.ts";
import { AbortAfterPersistence, CallbackAbort, RecordNotFound } from "./errors.ts";
import { clearErrors } from "./errors-collection.ts";
import type { Executor } from "./executor.ts";
import {
  declared,
  type AfterCallbackKind,
  type BeforeCallbackKind,
  type CallbackKind,
} from "./declarations.ts";
import type { ModelBase, ModelClass } from "./model.ts";
import { Negated, type Condition } from "./query.ts";
import { state } from "./record-state.ts";
import { column, sql } from "./sql.ts";
import { timestampsFor } from "./timestamps.ts";
import { runAfter, writeAll, type PreparedWrite } from "./unit-of-work.ts";
import { runValidations, type UniquenessOptions } from "./validations.ts";

function modelOf(record: ModelBase): ModelClass {
  return record.constructor as ModelClass;
}

/**
 * What a lifecycle run ended with. Refusals are outcomes (the non-throwing methods return
 * `false`, the `OrThrow` ones throw); constraint and D1 errors are thrown (ADR-0005).
 */
export type Outcome =
  | { status: "saved" }
  | { status: "invalid" }
  | { status: "aborted"; reason: string };

/** What a destroy lifecycle run ended with. */
export type DestroyOutcome =
  | { status: "destroyed" }
  | { status: "aborted"; reason: string }
  | { status: "restricted"; reason: string };

type Validity = "valid" | "invalid" | "aborted";

/**
 * Whether another row already has `value` for `attribute`: a `SELECT 1 … LIMIT 1` through the
 * record's own Database (so its Session), within the scope, leaving out the record's own row.
 */
async function isTaken(
  record: ModelBase,
  attribute: string,
  value: unknown,
  { scope = [], caseSensitive = true }: UniquenessOptions,
): Promise<boolean> {
  const model = modelOf(record);
  const recordState = record[state];
  const conditions: Condition[] = [
    caseSensitive ? { [attribute]: value } : sql`lower(${column(attribute)}) = lower(${value})`,
    ...scope.map((name) => ({ [name]: recordState.read(name) })),
  ];
  if (!recordState.isNew) {
    recordState.requireKey("be checked for uniqueness");
    conditions.push(new Negated({ [model.primaryKey]: recordState.storedKeyValue }));
  }
  const query = compileSelect({ model, conditions, order: [], limit: 1 }, "1");
  return (await recordState.executor.all(query)).length > 0;
}

/** Runs the Model's callbacks of `kind` in declaration order, awaiting each. */
async function runCallbacks(record: ModelBase, kind: CallbackKind): Promise<void> {
  for (const callback of declared(modelOf(record), kind)) {
    await callback(record);
  }
}

/** Runs callbacks of `kind`; an `abort()` from one sets `abortReason` and returns `false`. */
async function runAbortableCallbacks(
  record: ModelBase,
  kind: BeforeCallbackKind,
): Promise<boolean> {
  try {
    await runCallbacks(record, kind);
    return true;
  } catch (error) {
    if (!(error instanceof CallbackAbort)) throw error;
    record[state].abortReason = error.reason;
    return false;
  }
}

/** Whether the record is valid: `isValid()`'s answer. */
export async function validateRecord(record: ModelBase): Promise<boolean> {
  return (await validation(record)) === "valid";
}

/**
 * Clears `errors` and `abortReason`, then beforeValidation → validators → afterValidation.
 * An `abort()` in either callback makes the record "aborted" (not valid).
 */
async function validation(record: ModelBase): Promise<Validity> {
  const recordState = record[state];
  recordState.errors[clearErrors]();
  recordState.abortReason = undefined;
  if (!(await runAbortableCallbacks(record, "beforeValidation"))) return "aborted";
  await runValidations(declared(modelOf(record), "validations"), {
    record,
    read: (attribute) => recordState.read(attribute),
    errors: recordState.errors,
    isTaken: (attribute, value, options) => isTaken(record, attribute, value, options),
  });
  if (!(await runAbortableCallbacks(record, "afterValidation"))) return "aborted";
  return recordState.errors.isEmpty() ? "valid" : "invalid";
}

/** A record's save or destroy, prepared: its writes, or why it was refused. */
export type Plan =
  | { status: "ready"; writes: PreparedWrite[] }
  | { status: "invalid" }
  | { status: "aborted"; reason: string }
  | { status: "restricted"; reason: string };

/**
 * The save lifecycle, in the contract's order:
 * can this record be used → beforeValidation → validators → afterValidation
 * → beforeSave → beforeCreate | beforeUpdate → write (skipped when clean) → commit state
 * → afterCreate | afterUpdate → afterSave.
 */
export async function saveLifecycle(record: ModelBase): Promise<Outcome> {
  const plan = await prepareSave(record);
  if (plan.status === "restricted") throw new TypeError("a save is never restricted");
  if (plan.status !== "ready") return plan;
  await runPlan(record[state].executor, plan.writes);
  return { status: "saved" };
}

/** Everything a save does before writing: validation and the before-callbacks. */
async function prepareSave(record: ModelBase): Promise<Plan> {
  const recordState = record[state];
  recordState.requireLive("be saved");
  const validity = await validation(record);
  if (validity === "invalid") return { status: "invalid" };
  const isInsert = recordState.isNew;
  if (validity === "aborted" || !(await beforeWrite(record, isInsert))) {
    return { status: "aborted", reason: recordState.abortReason ?? "" };
  }
  return { status: "ready", writes: [saveWrite(record, isInsert)] };
}

/** Writes prepared writes as one unit, then runs their after-callbacks in order. */
async function runPlan(executor: Executor, writes: readonly PreparedWrite[]): Promise<void> {
  await writeAll(executor, writes);
  await runAfter(writes);
}

/**
 * Runs after-write callbacks. The write already succeeded, so an `abort()` here can't refuse
 * anything: it becomes `AbortAfterPersistence`. Any other error propagates unchanged.
 */
async function runAfterCallbacks(
  record: ModelBase,
  kind: AfterCallbackKind,
  lifecycle: "save" | "destroy",
): Promise<void> {
  try {
    await runCallbacks(record, kind);
  } catch (error) {
    if (error instanceof CallbackAbort) throw new AbortAfterPersistence(kind, lifecycle, error);
    throw error;
  }
}

/** beforeSave, then beforeCreate or beforeUpdate; `false` if one aborted. */
async function beforeWrite(record: ModelBase, isInsert: boolean): Promise<boolean> {
  return (
    (await runAbortableCallbacks(record, "beforeSave")) &&
    (await runAbortableCallbacks(record, isInsert ? "beforeCreate" : "beforeUpdate"))
  );
}

/**
 * A save's write: INSERT the assigned attributes (`RETURNING *` loads what D1 stored), or
 * UPDATE the changed ones, plus timestamps; a clean record sends nothing. Its after-callbacks
 * are afterCreate or afterUpdate, then afterSave.
 */
function saveWrite(record: ModelBase, isInsert: boolean): PreparedWrite {
  const recordState = record[state];
  const model = modelOf(record);
  const after = async () => {
    await runAfterCallbacks(record, isInsert ? "afterCreate" : "afterUpdate", "save");
    await runAfterCallbacks(record, "afterSave", "save");
  };
  if (isInsert) {
    const own = recordState.insertAssignments();
    const insert = compileInsert(model, [...own, ...timestampsFor(model, "insert", own)]);
    return {
      statements: [insert],
      commit: ([result]) => recordState.commitInsert(result?.results[0]),
      after,
    };
  }
  const own = recordState.updateAssignments();
  if (own.length === 0) return { statements: [], commit: () => recordState.commitClean(), after };
  const stamps = timestampsFor(model, "update", own);
  return {
    statements: [compileUpdate(model, [...own, ...stamps], recordState.storedKey)],
    commit: () => recordState.commitUpdate(stamps),
    after,
  };
}

/**
 * The destroy lifecycle: can this record be used → beforeDestroy → its `dependent:` strategies
 * → DELETE by the stored key (skipped for a never-saved record: there's no row, as in Rails)
 * → mark destroyed → afterDestroy. Every write, dependents' included, is one atomic batch.
 */
export async function destroyLifecycle(record: ModelBase): Promise<DestroyOutcome> {
  const plan = await prepareDestroy(record);
  if (plan.status === "invalid") throw new TypeError("a destroy is never invalid");
  if (plan.status !== "ready") return plan;
  await runPlan(record[state].executor, plan.writes);
  return { status: "destroyed" };
}

/** Everything a destroy does before writing: beforeDestroy, then its dependents' plans. */
export async function prepareDestroy(record: ModelBase): Promise<Plan> {
  const recordState = record[state];
  recordState.requireLive("be destroyed");
  recordState.abortReason = undefined;
  if (!(await runAbortableCallbacks(record, "beforeDestroy"))) {
    return { status: "aborted", reason: recordState.abortReason ?? "" };
  }
  const dependents = recordState.isNew ? { writes: [] } : await prepareDependents(record);
  if ("status" in dependents) return dependents;
  const deletion = recordState.isNew ? [] : [compileDelete(modelOf(record), recordState.storedKey)];
  // Dependents first: their records go before the owner's row, which they may point at.
  const writes = [
    ...dependents.writes,
    {
      statements: deletion,
      commit: () => recordState.markDestroyed(),
      after: () => runAfterCallbacks(record, "afterDestroy", "destroy"),
    },
  ];
  return { status: "ready", writes };
}

/** Loads the record's row again by its stored primary key, discarding unsaved changes. */
export async function reloadRecord(record: ModelBase): Promise<void> {
  const recordState = record[state];
  recordState.requireLive("be reloaded");
  const { executor } = recordState;
  const model = modelOf(record);
  if (recordState.isNew) {
    throw new RecordNotFound(
      `${model.name} record hasn't been saved, so there's nothing to reload`,
    );
  }
  const key = recordState.storedKeyValue;
  const query = { model, conditions: [{ [model.primaryKey]: key }], order: [], limit: 1 };
  const [row] = await executor.all(compileSelect(query));
  if (row === undefined) {
    throw new RecordNotFound(`${model.name} with ${model.primaryKey} ${String(key)} not found`);
  }
  recordState.clearAssociations();
  recordState.loadRow(row);
}
