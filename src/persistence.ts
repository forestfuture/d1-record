import { compileInsert } from "./compiler.ts";
import { readValue } from "./conversion.ts";
import type { Executor } from "./executor.ts";
import type { ModelBase, ModelClass } from "./model.ts";
import { state, values } from "./record-state.ts";

function modelOf(record: ModelBase): ModelClass {
  return record.constructor as ModelClass;
}

/** Loads a D1 row into a record, which becomes persisted; absent columns stay unloaded. */
export function applyRow(record: ModelBase, row: Record<string, unknown>): void {
  for (const [name, { type, column }] of modelOf(record).attributeDefinitions) {
    if (column in row) record[values][name] = readValue(type, row[column]);
  }
  record[state].lifecycle = "persisted";
  record[state].assigned.clear();
}

function executorOf(record: ModelBase): Executor {
  const { executor } = record[state];
  if (executor === undefined) throw new Error("record has no Database");
  return executor;
}

/** Inserts a new record, or updates a persisted one. */
export async function saveRecord(record: ModelBase): Promise<boolean> {
  const executor = executorOf(record);
  const assignments = [...record[state].assigned].map(
    (name) => [name, record[values][name]] as const,
  );
  const { sql, params } = compileInsert(modelOf(record), assignments);
  const [row] = await executor.all(sql, params);
  if (row !== undefined) applyRow(record, row);
  return true;
}
