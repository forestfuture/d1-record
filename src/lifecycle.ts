import {
  compileDelete,
  compileInsert,
  compileSelect,
  compileUpdate,
  Negated,
  type Assignment,
  type CompiledQuery,
  type Condition,
} from "./compiler.ts";
import { translateConstraintError } from "./constraints.ts";
import { AbortAfterPersistence, CallbackAbort, RecordNotFound } from "./errors.ts";
import { declared } from "./declarations.ts";
import type { Callback, ModelBase, ModelClass } from "./model.ts";
import { state } from "./record-state.ts";
import { column, sql } from "./sql.ts";
import { runValidations, type UniquenessOptions, type Validation } from "./validations.ts";

function modelOf(record: ModelBase): ModelClass {
  return record.constructor as ModelClass;
}

/** Runs a write for `record`, translating D1 constraint failures into `ConstraintViolation`s. */
async function write(
  record: ModelBase,
  { sql, params }: CompiledQuery,
): Promise<Record<string, unknown>[]> {
  const { executor } = record[state];
  try {
    return await executor.all(sql, params);
  } catch (error) {
    throw translateConstraintError(error, modelOf(record));
  }
}

/** Whether the Model declares `name` as a datetime attribute, which turns its timestamp on. */
function hasTimestamp(record: ModelBase, name: "createdAt" | "updatedAt"): boolean {
  return modelOf(record).attributeDefinitions.get(name)?.type === "datetime";
}

/**
 * The timestamps to add to a write: `createdAt` and `updatedAt` on insert, `updatedAt` on
 * update. Never one the caller assigned. They join the pending write and reach the record
 * only after D1 accepts it, so a failed save leaves nothing but the caller's own changes.
 */
function timestampsFor(
  record: ModelBase,
  isInsert: boolean,
  own: readonly Assignment[],
): Assignment[] {
  const now = new Date();
  const assigned = new Set(own.map(([name]) => name));
  const names = isInsert ? (["createdAt", "updatedAt"] as const) : (["updatedAt"] as const);
  return names
    .filter((name) => hasTimestamp(record, name) && !assigned.has(name))
    .map((name): Assignment => [name, now]);
}

/**
 * What a lifecycle run ended with. Refusals are outcomes (the non-throwing methods return
 * `false`, the `OrThrow` ones throw); constraint and D1 errors are thrown (ADR-0005).
 */
export type Outcome =
  | { status: "saved" }
  | { status: "invalid" }
  | { status: "aborted"; reason: string };

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
  const { sql: text, params } = compileSelect({ model, conditions, order: [], limit: 1 }, "1");
  return (await recordState.executor.all(text, params)).length > 0;
}

/** Runs the Model's callbacks of `kind` in declaration order, awaiting each. */
async function runCallbacks(record: ModelBase, kind: string): Promise<void> {
  for (const callback of declared<Callback<ModelBase>>(modelOf(record), kind)) {
    await callback(record);
  }
}

/** Runs callbacks of `kind`; an `abort()` from one sets `abortReason` and returns `false`. */
async function runAbortableCallbacks(record: ModelBase, kind: string): Promise<boolean> {
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
  recordState.errors.clear();
  recordState.abortReason = undefined;
  if (!(await runAbortableCallbacks(record, "beforeValidation"))) return "aborted";
  await runValidations(declared<Validation>(modelOf(record), "validations"), {
    record,
    read: (attribute) => recordState.read(attribute),
    errors: recordState.errors,
    isTaken: (attribute, value, options) => isTaken(record, attribute, value, options),
  });
  if (!(await runAbortableCallbacks(record, "afterValidation"))) return "aborted";
  return recordState.errors.isEmpty() ? "valid" : "invalid";
}

/**
 * The save lifecycle, in the contract's order:
 * can this record be used → beforeValidation → validators → afterValidation
 * → beforeSave → beforeCreate | beforeUpdate → write (skipped when clean) → commit state
 * → afterCreate | afterUpdate → afterSave.
 */
export async function saveLifecycle(record: ModelBase): Promise<Outcome> {
  const recordState = record[state];
  recordState.requireLive("be saved");
  const validity = await validation(record);
  if (validity === "invalid") return { status: "invalid" };
  const isInsert = recordState.isNew;
  if (validity === "aborted" || !(await beforeWrite(record, isInsert))) {
    return { status: "aborted", reason: recordState.abortReason ?? "" };
  }
  await (isInsert ? insertRecord(record) : updateRecord(record));
  await runAfterCallbacks(record, isInsert ? "afterCreate" : "afterUpdate");
  await runAfterCallbacks(record, "afterSave");
  return { status: "saved" };
}

/**
 * Runs after-write callbacks. The write already succeeded, so an `abort()` here can't refuse
 * anything: it becomes `AbortAfterPersistence`. Any other error propagates unchanged.
 */
async function runAfterCallbacks(record: ModelBase, kind: string): Promise<void> {
  try {
    await runCallbacks(record, kind);
  } catch (error) {
    if (error instanceof CallbackAbort) throw new AbortAfterPersistence(kind, error);
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

/** INSERT the assigned attributes (plus timestamps); `RETURNING *` loads what D1 stored. */
async function insertRecord(record: ModelBase): Promise<true> {
  const recordState = record[state];
  const own = recordState.insertAssignments();
  const stamps = timestampsFor(record, true, own);
  const [row] = await write(record, compileInsert(modelOf(record), [...own, ...stamps]));
  recordState.commitInsert(row);
  return true;
}

/** UPDATE only the changed attributes (plus `updatedAt`); a clean record sends nothing. */
async function updateRecord(record: ModelBase): Promise<true> {
  const recordState = record[state];
  const own = recordState.updateAssignments();
  if (own.length === 0) {
    recordState.commitClean();
    return true;
  }
  const stamps = timestampsFor(record, false, own);
  const update = compileUpdate(modelOf(record), [...own, ...stamps], recordState.storedKey);
  await write(record, update);
  recordState.commitUpdate(stamps);
  return true;
}

/**
 * The destroy lifecycle: can this record be used → beforeDestroy → DELETE by the stored key
 * (skipped for a never-saved record: there's no row, as in Rails) → mark destroyed
 * → afterDestroy.
 */
export async function destroyLifecycle(
  record: ModelBase,
): Promise<{ status: "destroyed" } | { status: "aborted"; reason: string }> {
  const recordState = record[state];
  recordState.requireLive("be destroyed");
  recordState.abortReason = undefined;
  if (!(await runAbortableCallbacks(record, "beforeDestroy"))) {
    return { status: "aborted", reason: recordState.abortReason ?? "" };
  }
  if (!recordState.isNew) {
    await write(record, compileDelete(modelOf(record), recordState.storedKey));
  }
  recordState.markDestroyed();
  await runAfterCallbacks(record, "afterDestroy");
  return { status: "destroyed" };
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
  const { sql, params } = compileSelect(query);
  const [row] = await executor.all(sql, params);
  if (row === undefined) {
    throw new RecordNotFound(`${model.name} with ${model.primaryKey} ${String(key)} not found`);
  }
  recordState.loadRow(row);
}
