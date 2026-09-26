import { compileInsert, compileUpdate } from "./compiler.ts";
import { readValue, writeValue } from "./conversion.ts";
import type { Executor } from "./executor.ts";
import type { ModelBase, ModelClass } from "./model.ts";
import { state, values } from "./record-state.ts";

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

/** Loaded attributes whose stored form differs from the snapshot. */
export function changedNames(record: ModelBase): string[] {
  const { snapshot } = record[state];
  return Object.keys(record[values]).filter(
    (name) => !snapshot.has(name) || snapshot.get(name) !== storedForm(record, name),
  );
}

function executorOf(record: ModelBase): Executor {
  const { executor } = record[state];
  if (executor === undefined) throw new Error("record has no Database");
  return executor;
}

/** Inserts a new record, or updates a persisted one's changed attributes. */
export async function saveRecord(record: ModelBase): Promise<boolean> {
  const executor = executorOf(record);
  if (record[state].lifecycle === "new") {
    const assignments = [...record[state].assigned].map((name): Assignment => [
      name,
      record[values][name],
    ]);
    const { sql, params } = compileInsert(modelOf(record), assignments);
    const [row] = await executor.all(sql, params);
    if (row !== undefined) applyRow(record, row);
    return true;
  }
  const changed = changedNames(record);
  if (changed.length === 0) return true;
  const model = modelOf(record);
  const storedKey = record[state].snapshot.get(model.primaryKey);
  const assignments = changed.map((name): Assignment => [name, record[values][name]]);
  const { sql, params } = compileUpdate(model, assignments, storedKey);
  await executor.all(sql, params);
  markSaved(record);
  return true;
}
