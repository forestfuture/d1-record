import {
  compileDelete,
  compileInsert,
  compileSelect,
  compileUpdate,
  type Assignment,
  type CompiledQuery,
} from "./compiler.ts";
import { translateConstraintError } from "./constraints.ts";
import { readValue } from "./conversion.ts";
import { RecordNotFound } from "./errors.ts";
import { attributeOf } from "./metadata.ts";
import type { ModelBase, ModelClass } from "./model.ts";
import { state } from "./record-state.ts";

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

/** Inserts a new record, or updates a persisted one's changed attributes. */
export async function saveRecord(record: ModelBase): Promise<boolean> {
  record[state].requireLive("be saved");
  return record[state].lifecycle === "new" ? insertRecord(record) : updateRecord(record);
}

/** INSERT the assigned attributes (plus timestamps); `RETURNING *` loads what D1 stored. */
async function insertRecord(record: ModelBase): Promise<true> {
  const own = record[state].insertAssignments();
  const stamps = timestampsFor(record, true, own);
  const [row] = await write(record, compileInsert(modelOf(record), [...own, ...stamps]));
  record[state].commitInsert(row);
  return true;
}

/** UPDATE only the changed attributes (plus `updatedAt`); a clean record sends nothing. */
async function updateRecord(record: ModelBase): Promise<true> {
  const own = record[state].updateAssignments();
  if (own.length === 0) {
    record[state].commitClean();
    return true;
  }
  const stamps = timestampsFor(record, false, own);
  const update = compileUpdate(modelOf(record), [...own, ...stamps], record[state].storedKey);
  await write(record, update);
  record[state].commitUpdate(stamps);
  return true;
}

/** Deletes the record's row by its stored key; the record becomes a destroyed snapshot. */
export async function destroyRecord(record: ModelBase): Promise<void> {
  record[state].requireLive("be destroyed again");
  // A never-saved record has no row, so there's nothing to delete (as in Rails).
  if (record[state].lifecycle !== "new") {
    await write(record, compileDelete(modelOf(record), record[state].storedKey));
  }
  record[state].markDestroyed();
}

/** Loads the record's row again by its stored primary key, discarding unsaved changes. */
export async function reloadRecord(record: ModelBase): Promise<void> {
  record[state].requireLive("be reloaded");
  const { executor } = record[state];
  const model = modelOf(record);
  if (record[state].lifecycle === "new") {
    throw new RecordNotFound(
      `${model.name} record hasn't been saved, so there's nothing to reload`,
    );
  }
  const { type } = attributeOf(model, model.primaryKey);
  const key = readValue(type, record[state].storedKey);
  const query = { model, conditions: [{ [model.primaryKey]: key }], order: [], limit: 1 };
  const { sql, params } = compileSelect(query);
  const [row] = await executor.all(sql, params);
  if (row === undefined) {
    throw new RecordNotFound(`${model.name} with ${model.primaryKey} ${String(key)} not found`);
  }
  record[state].loadRow(row);
}
