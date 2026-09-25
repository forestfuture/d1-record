import { attributeOf, type ModelBase, type ModelClass } from "./model.ts";
import { ColumnReference, SafeSql } from "./sql.ts";
import { writeUntypedValue, writeValue } from "./conversion.ts";

export interface CompiledQuery {
  sql: string;
  params: unknown[];
}

export type OrderDirection = "asc" | "desc";

export interface OrderTerm {
  attribute: string;
  direction: OrderDirection;
}

/** Everything a Relation knows about its query; Relations copy it, never mutate it. */
export interface SelectQuery {
  model: ModelClass<ModelBase>;
  conditions: readonly Condition[];
  order: readonly OrderTerm[];
  limit?: number;
  offset?: number;
}

export type Condition = Record<string, unknown> | SafeSql;

/** Quotes a SQLite identifier; embedded double quotes are doubled. */
function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export function compileSelect(query: SelectQuery): CompiledQuery {
  const params: unknown[] = [];
  let sql = `SELECT * FROM ${quoteIdentifier(query.model.tableName)}`;
  sql += compileWhere(query, params);
  sql += compileOrder(query);
  sql += compilePagination(query, params);
  return { sql, params };
}

function compileWhere({ model, conditions }: SelectQuery, params: unknown[]): string {
  const predicates: string[] = [];
  for (const condition of conditions) {
    if (condition instanceof SafeSql) {
      predicates.push(`(${compileFragment(condition, model, params)})`);
      continue;
    }
    for (const [name, value] of Object.entries(condition)) {
      const attribute = attributeOf(model, name);
      if (value === null) {
        predicates.push(`${quoteIdentifier(attribute.column)} IS NULL`);
        continue;
      }
      predicates.push(`${quoteIdentifier(attribute.column)} = ?`);
      params.push(writeValue(attribute.type, value));
    }
  }
  return predicates.length > 0 ? ` WHERE ${predicates.join(" AND ")}` : "";
}

function compileOrder({ model, order }: SelectQuery): string {
  if (order.length === 0) return "";
  const terms = order.map(
    ({ attribute, direction }) =>
      `${quoteIdentifier(attributeOf(model, attribute).column)} ${direction.toUpperCase()}`,
  );
  return ` ORDER BY ${terms.join(", ")}`;
}

function compilePagination({ limit, offset }: SelectQuery, params: unknown[]): string {
  if (limit === undefined && offset === undefined) return "";
  // SQLite only accepts OFFSET after a LIMIT; -1 means "no limit".
  params.push(limit ?? -1);
  if (offset === undefined) return " LIMIT ?";
  params.push(offset);
  return " LIMIT ? OFFSET ?";
}

/** Appends the fragment's values to `params` and returns its SQL text. */
function compileFragment(
  fragment: SafeSql,
  model: ModelClass<ModelBase>,
  params: unknown[],
): string {
  let text = fragment.strings[0] ?? "";
  fragment.values.forEach((value, index) => {
    if (value instanceof ColumnReference) {
      text += quoteIdentifier(attributeOf(model, value.attribute).column);
    } else {
      params.push(writeUntypedValue(value));
      text += "?";
    }
    text += fragment.strings[index + 1] ?? "";
  });
  return text;
}
