import { compileDelete, compileInsert, compileSelect, compileUpdate } from "./compiler.ts";
import { translateConstraintError } from "./constraints.ts";
import { MissingAttribute, NoDatabase, RecordDestroyed, RecordNotFound } from "./errors.ts";
import { attributeOf } from "./metadata.ts";
import { readValue, writeValue } from "./conversion.ts";
import type { Executor } from "./executor.ts";
import type { ModelBase, ModelClass } from "./model.ts";
import { state, values, type Changes } from "./record-state.ts";

type Assignment = readonly [attribute: string, value: unknown];

function modelOf(record: ModelBase): ModelClass {
  return record.constructor as ModelClass;
}

/** An attribute's current value in its stored form, for comparing with the snapshot. */
function storedForm(record: ModelBase, name: string): unknown {
  const { type } = modelOf(record).attributeDefinitions.get(name)!;
  return writeValue(type, record[values][name]);
}

/** Records the current values as saved: clean, and persisted. */
function markSaved(record: ModelBase): void {
  const { snapshot } = record[state];
  snapshot.clear();
  for (const name of Object.keys(record[values])) snapshot.set(name, storedForm(record, name));
  record[state].lifecycle = "persisted";
  record[state].assigned.clear();
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

/** `{ attribute: [before, after] }`; "before" is read back from the snapshot, so it's a fresh copy. */
export function changesOf(record: ModelBase): Changes {
  const { snapshot } = record[state];
  const definitions = modelOf(record).attributeDefinitions;
  const changes: Changes = {};
  for (const name of changedNames(record)) {
    const before = snapshot.has(name)
      ? readValue(definitions.get(name)!.type, snapshot.get(name))
      : null;
    changes[name] = [before, record[values][name]];
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
  const model = modelOf(record);
  await write(record, compileDelete(model, record[state].snapshot.get(model.primaryKey)));
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
  const key = readValue(type, record[state].snapshot.get(model.primaryKey));
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
 * Sets timestamps just before a write, unless they were assigned explicitly: on insert,
 * `createdAt` and `updatedAt`; on update (only when something changed), `updatedAt`.
 */
function stampTimestamps(record: ModelBase, changed: readonly string[]): void {
  const now = new Date();
  const isInsert = record[state].lifecycle === "new";
  const stamp = isInsert ? (["createdAt", "updatedAt"] as const) : (["updatedAt"] as const);
  for (const name of stamp) {
    if (hasTimestamp(record, name) && !changed.includes(name)) {
      record[values][name] = now;
      record[state].assigned.add(name);
    }
  }
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
  const pending = changedNames(record);
  if (record[state].lifecycle === "new" || pending.length > 0) stampTimestamps(record, pending);
  const changes = changesOf(record);
  if (record[state].lifecycle === "new") {
    const assignments = [...record[state].assigned].map((name): Assignment => [
      name,
      record[values][name],
    ]);
    const [row] = await write(record, compileInsert(modelOf(record), assignments));
    if (row !== undefined) applyRow(record, row);
    record[state].savedChanges = changes;
    return true;
  }
  const changed = Object.keys(changes);
  if (changed.length === 0) {
    record[state].savedChanges = {};
    return true;
  }
  const model = modelOf(record);
  const storedKey = record[state].snapshot.get(model.primaryKey);
  const assignments = changed.map((name): Assignment => [name, record[values][name]]);
  await write(record, compileUpdate(model, assignments, storedKey));
  markSaved(record);
  record[state].savedChanges = changes;
  return true;
}
