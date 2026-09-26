import {
  compileDelete,
  compileInsert,
  compileSelect,
  compileUpdate,
  type Assignment,
} from "./compiler.ts";
import { translateConstraintError } from "./constraints.ts";
import { MissingAttribute, NoDatabase, RecordDestroyed, RecordNotFound } from "./errors.ts";
import { attributeOf } from "./metadata.ts";
import { readValue, writeValue } from "./conversion.ts";
import type { Executor } from "./executor.ts";
import type { ModelBase, ModelClass } from "./model.ts";
import { state, values, type Changes } from "./record-state.ts";

function modelOf(record: ModelBase): ModelClass {
  return record.constructor as ModelClass;
}

/** An attribute's current value in its stored form, for comparing with the snapshot. */
function storedForm(record: ModelBase, name: string): unknown {
  const { type } = modelOf(record).attributeDefinitions.get(name)!;
  return writeValue(type, record[values][name]);
}

/** A copy of an attribute's current value, read back from its stored form (so no shared objects). */
function copyOf(record: ModelBase, name: string): unknown {
  const { type } = modelOf(record).attributeDefinitions.get(name)!;
  return readValue(type, storedForm(record, name));
}

/** Records the current values as saved: clean, and persisted. */
function markSaved(record: ModelBase): void {
  const { snapshot } = record[state];
  snapshot.clear();
  for (const name of Object.keys(record[values])) snapshot.set(name, storedForm(record, name));
  record[state].lifecycle = "persisted";
  record[state].assigned.clear();
}

/** The primary key as stored in D1: the row's key before any unsaved change to it. */
function storedKeyOf(record: ModelBase): unknown {
  return record[state].snapshot.get(modelOf(record).primaryKey);
}

/** Loads a D1 row into a record, which becomes persisted and clean; absent columns stay unloaded. */
export function applyRow(record: ModelBase, row: Record<string, unknown>): void {
  for (const [name, { type, column }] of modelOf(record).attributeDefinitions) {
    if (column in row) record[values][name] = readValue(type, row[column]);
  }
  markSaved(record);
}

/** A new record's assigned attributes, or a persisted one's that differ from the snapshot. */
export function changedNames(record: ModelBase): string[] {
  const { lifecycle, assigned, snapshot } = record[state];
  if (lifecycle === "new") return [...assigned];
  return Object.keys(record[values]).filter(
    (name) => !snapshot.has(name) || snapshot.get(name) !== storedForm(record, name),
  );
}

/** `{ attribute: [before, after] }`; both are copies, never the record's own objects. */
export function changesOf(record: ModelBase): Changes {
  const { snapshot } = record[state];
  const definitions = modelOf(record).attributeDefinitions;
  const changes: Changes = {};
  for (const name of changedNames(record)) {
    const before = snapshot.has(name)
      ? readValue(definitions.get(name)!.type, snapshot.get(name))
      : null;
    changes[name] = [before, copyOf(record, name)];
  }
  return changes;
}

/**
 * Assigns attributes without saving. Unknown names throw `UnknownAttribute`; `undefined`
 * throws `TypeError`, because it would silently write NULL (use `null` for that).
 */
export function assignAttributes(record: ModelBase, attributes: Record<string, unknown>): void {
  const model = modelOf(record);
  for (const [name, value] of Object.entries(attributes)) {
    attributeOf(model, name);
    if (value === undefined) {
      throw new TypeError(`${model.name}: got undefined for "${name}"; use null to store NULL`);
    }
    record[values][name] = value;
    record[state].assigned.add(name);
  }
}

/**
 * Refuses to use a record as a live one when it can't be: a destroyed record is a read-only
 * snapshot, and a persisted record without its primary key (from `select(...).distinct()`)
 * has no identity to write by.
 */
export function requireLive(record: ModelBase, action: string): void {
  const model = modelOf(record);
  const { lifecycle, snapshot } = record[state];
  if (lifecycle === "destroyed") {
    throw new RecordDestroyed(`${model.name} record was destroyed; it can't ${action}`);
  }
  if (lifecycle === "persisted" && !snapshot.has(model.primaryKey)) {
    throw new MissingAttribute(
      `${model.name} record has no primary key loaded (it came from select(...).distinct()); ` +
        `it can't ${action}`,
    );
  }
}

/** Deletes the record's row by its stored key; the record becomes a destroyed snapshot. */
export async function destroyRecord(record: ModelBase): Promise<void> {
  requireLive(record, "be destroyed again");
  // A never-saved record has no row, so there's nothing to delete (as in Rails).
  if (record[state].lifecycle !== "new") {
    await write(record, compileDelete(modelOf(record), storedKeyOf(record)));
  }
  record[state].lifecycle = "destroyed";
}

/** Loads the record's row again by its stored primary key, discarding unsaved changes. */
export async function reloadRecord(record: ModelBase): Promise<void> {
  requireLive(record, "be reloaded");
  const executor = executorOf(record);
  const model = modelOf(record);
  if (record[state].lifecycle === "new") {
    throw new RecordNotFound(
      `${model.name} record hasn't been saved, so there's nothing to reload`,
    );
  }
  const { type } = attributeOf(model, model.primaryKey);
  const key = readValue(type, storedKeyOf(record));
  const query = { model, conditions: [{ [model.primaryKey]: key }], order: [], limit: 1 };
  const { sql, params } = compileSelect(query);
  const [row] = await executor.all(sql, params);
  if (row === undefined) {
    throw new RecordNotFound(`${model.name} with ${model.primaryKey} ${String(key)} not found`);
  }
  applyRow(record, row);
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
  assigned: readonly string[],
): Assignment[] {
  const now = new Date();
  const names = isInsert ? (["createdAt", "updatedAt"] as const) : (["updatedAt"] as const);
  return names
    .filter((name) => hasTimestamp(record, name) && !assigned.includes(name))
    .map((name): Assignment => [name, now]);
}

/** Runs a write for `record`, translating D1 constraint failures into `ConstraintViolation`s. */
async function write(
  record: ModelBase,
  { sql, params }: { sql: string; params: unknown[] },
): Promise<Record<string, unknown>[]> {
  try {
    return await executorOf(record).all(sql, params);
  } catch (error) {
    throw translateConstraintError(error, modelOf(record));
  }
}

function executorOf(record: ModelBase): Executor {
  const { executor } = record[state];
  if (executor === undefined) {
    const { name } = modelOf(record);
    throw new NoDatabase(
      `${name} record has no Database; build or load records through db.model(${name})`,
    );
  }
  return executor;
}

/** Inserts a new record, or updates a persisted one's changed attributes. */
export async function saveRecord(record: ModelBase): Promise<boolean> {
  requireLive(record, "be saved");
  return record[state].lifecycle === "new" ? insertRecord(record) : updateRecord(record);
}

/** The attributes as they'd be written: `[name, current value]`. */
function assignmentsOf(record: ModelBase, names: readonly string[]): Assignment[] {
  return names.map((name): Assignment => [name, record[values][name]]);
}

/** INSERT the assigned attributes (plus timestamps); `RETURNING *` loads what D1 stored. */
async function insertRecord(record: ModelBase): Promise<true> {
  const assigned = [...record[state].assigned];
  const assignments = [
    ...assignmentsOf(record, assigned),
    ...timestampsFor(record, true, assigned),
  ];
  const [row] = await write(record, compileInsert(modelOf(record), assignments));
  // RETURNING * always yields the stored row; without one, keep the values as written.
  if (row === undefined) markSaved(record);
  else applyRow(record, row);
  // Everything the new row holds, including what D1 filled in (generated key, defaults).
  record[state].savedChanges = Object.fromEntries(
    Object.keys(record[values])
      .filter((name) => record[values][name] !== null)
      .map((name) => [name, [null, copyOf(record, name)]]),
  );
  return true;
}

/** UPDATE only the changed attributes (plus `updatedAt`); a clean record sends nothing. */
async function updateRecord(record: ModelBase): Promise<true> {
  const changed = changedNames(record);
  if (changed.length === 0) {
    record[state].savedChanges = {};
    return true;
  }
  const stamps = timestampsFor(record, false, changed);
  const assignments = [...assignmentsOf(record, changed), ...stamps];
  await write(record, compileUpdate(modelOf(record), assignments, storedKeyOf(record)));
  for (const [name, value] of stamps) record[values][name] = value;
  record[state].savedChanges = changesOf(record);
  markSaved(record);
  return true;
}
