import { attributeOf, type AttributeDefinition, type ModelBase, type ModelClass } from "./model.ts";
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

export type Condition = Record<string, unknown> | SafeSql | Negated;

/** A condition from `whereNot`: the whole condition is negated, `NOT (…)`. */
export class Negated {
  readonly condition: Condition;

  constructor(condition: Condition) {
    this.condition = condition;
  }
}

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
  if (conditions.length === 0) return "";
  const predicates = conditions.map((condition) => compileCondition(condition, model, params));
  return ` WHERE ${predicates.join(" AND ")}`;
}

/** One condition as a single parenthesized predicate. */
function compileCondition(
  condition: Condition,
  model: ModelClass<ModelBase>,
  params: unknown[],
): string {
  if (condition instanceof Negated) {
    return `(NOT ${compileCondition(condition.condition, model, params)})`;
  }
  if (condition instanceof SafeSql) return `(${compileFragment(condition, model, params)})`;
  const parts = Object.entries(condition).map(([name, value]) =>
    compileEquality(attributeOf(model, name), value, params),
  );
  return `(${parts.join(" AND ")})`;
}

/** `attr = value`, with NULL and arrays (IN) handled the way the contract specifies. */
function compileEquality(
  attribute: AttributeDefinition,
  value: unknown,
  params: unknown[],
): string {
  const column = quoteIdentifier(attribute.column);
  if (value === null) return `${column} IS NULL`;
  if (!Array.isArray(value)) {
    params.push(writeValue(attribute.type, value));
    return `${column} = ?`;
  }
  const present = value.filter((item) => item !== null);
  const parts: string[] = [];
  if (present.length > 0) {
    params.push(...present.map((item) => writeValue(attribute.type, item)));
    parts.push(`${column} IN (${present.map(() => "?").join(", ")})`);
  }
  if (present.length < value.length) parts.push(`${column} IS NULL`);
  return parts.length > 0 ? `(${parts.join(" OR ")})` : "1 = 0";
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
