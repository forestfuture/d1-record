import {
  compileDelete,
  compileInsert,
  compileSelect,
  compileUpdate,
  type Assignment,
  type CompiledQuery,
} from "./compiler.ts";
import { translateConstraintError } from "./constraints.ts";
import { RecordNotFound } from "./errors.ts";
import type { ModelBase, ModelClass } from "./model.ts";
import { state } from "./record-state.ts";
import { runValidations } from "./validations.ts";

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
export type Outcome = { status: "saved" } | { status: "invalid" };

/** Clears `errors`, runs every validation, and reports whether the record is valid. */
export async function validateRecord(record: ModelBase): Promise<boolean> {
  const recordState = record[state];
  recordState.errors.clear();
  const read = (attribute: string) => recordState.read(attribute);
  await runValidations(record, modelOf(record).validations, read, recordState.errors);
  return recordState.errors.isEmpty();
}

/**
 * The save lifecycle: can this record be used → validation → the write (insert, or update of
 * the changed attributes, with timestamps) → commit the new state.
 */
export async function saveLifecycle(record: ModelBase): Promise<Outcome> {
  const recordState = record[state];
  recordState.requireLive("be saved");
  if (!(await validateRecord(record))) return { status: "invalid" };
  await (recordState.isNew ? insertRecord(record) : updateRecord(record));
  return { status: "saved" };
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

/** Deletes the record's row by its stored key; the record becomes a destroyed snapshot. */
export async function destroyRecord(record: ModelBase): Promise<void> {
  const recordState = record[state];
  recordState.requireLive("be destroyed");
  // A never-saved record has no row, so there's nothing to delete (as in Rails).
  if (!recordState.isNew) {
    await write(record, compileDelete(modelOf(record), recordState.storedKey));
  }
  recordState.markDestroyed();
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
