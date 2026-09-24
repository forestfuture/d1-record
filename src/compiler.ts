import type { ModelBase, ModelClass } from "./model.ts";

export interface CompiledQuery {
  sql: string;
  params: unknown[];
}

export interface SelectQuery {
  model: ModelClass<ModelBase>;
  conditions: readonly Record<string, unknown>[];
}

/** Quotes a SQLite identifier; embedded double quotes are doubled. */
export function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export function compileSelect({ model, conditions }: SelectQuery): CompiledQuery {
  const params: unknown[] = [];
  const predicates: string[] = [];
  for (const condition of conditions) {
    for (const [name, value] of Object.entries(condition)) {
      predicates.push(`${quoteIdentifier(name)} = ?`);
      params.push(value);
    }
  }
  let sql = `SELECT * FROM ${quoteIdentifier(model.tableName)}`;
  if (predicates.length > 0) sql += ` WHERE ${predicates.join(" AND ")}`;
  return { sql, params };
}
