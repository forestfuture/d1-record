import { attributeOf, type AttributeDefinition } from "./metadata.ts";
import type { ModelBase, ModelClass } from "./model.ts";
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
  /** Attributes to load; undefined loads every column. */
  select?: readonly string[];
  distinct?: boolean;
  /** From `none()`: matches nothing, so it's never sent to D1. */
  none?: boolean;
}

export type Condition = Record<string, unknown> | SafeSql | Negated | Either;

/** A condition from `or`: either side's conditions (each ANDed together) may match. */
export class Either {
  readonly left: readonly Condition[];
  readonly right: readonly Condition[];

  constructor(left: readonly Condition[], right: readonly Condition[]) {
    this.left = left;
    this.right = right;
  }
}

/** A condition from `whereNot`: the whole condition is negated, `NOT (…)`. */
export class Negated {
  readonly condition: Condition;

  constructor(condition: Condition) {
    this.condition = condition;
  }
}

/** Quotes a SQLite identifier; embedded double quotes are doubled. */
export function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** `projection` is the SELECT list; the library builds it, never the caller. */
export function compileSelect(query: SelectQuery, projection?: string): CompiledQuery {
  const params: unknown[] = [];
  const list = projection ?? compileColumns(query.model, query.select);
  let sql = `SELECT ${query.distinct ? "DISTINCT " : ""}${list}`;
  sql += ` FROM ${quoteIdentifier(query.model.tableName)}`;
  sql += compileWhere(query, params);
  sql += compileOrder(query);
  sql += compilePagination(query, params);
  return { sql, params };
}

function compileWhere({ model, conditions }: SelectQuery, params: unknown[]): string {
  return conditions.length === 0 ? "" : ` WHERE ${compileAll(conditions, model, params)}`;
}

/** Conditions ANDed together as one predicate; no conditions matches everything. */
function compileAll(
  conditions: readonly Condition[],
  model: ModelClass<ModelBase>,
  params: unknown[],
): string {
  if (conditions.length === 0) return "(1 = 1)";
  return `(${conditions.map((condition) => compileCondition(condition, model, params)).join(" AND ")})`;
}

/** One condition as a single parenthesized predicate. */
function compileCondition(
  condition: Condition,
  model: ModelClass<ModelBase>,
  params: unknown[],
): string {
  if (condition instanceof Either) {
    const left = compileAll(condition.left, model, params);
    const right = compileAll(condition.right, model, params);
    return `(${left} OR ${right})`;
  }
  if (condition instanceof Negated) {
    return `(NOT ${compileCondition(condition.condition, model, params)})`;
  }
  if (condition instanceof SafeSql) return `(${compileFragment(condition, model, params)})`;
  const parts = Object.entries(condition).map(([name, value]) =>
    compileEquality(attributeOf(model, name), value, params),
  );
  return `(${parts.join(" AND ")})`;
}

/** `INSERT … RETURNING *` for the given attribute values, or `DEFAULT VALUES` for none. */
export function compileInsert(
  model: ModelClass<ModelBase>,
  assignments: readonly (readonly [attribute: string, value: unknown])[],
): CompiledQuery {
  const table = quoteIdentifier(model.tableName);
  if (assignments.length === 0) {
    return { sql: `INSERT INTO ${table} DEFAULT VALUES RETURNING *`, params: [] };
  }
  const definitions = assignments.map(([name]) => attributeOf(model, name));
  const columns = definitions.map(({ column }) => quoteIdentifier(column)).join(", ");
  const placeholders = assignments.map(() => "?").join(", ");
  return {
    sql: `INSERT INTO ${table} (${columns}) VALUES (${placeholders}) RETURNING *`,
    params: assignments.map(([, value], index) => writeValue(definitions[index]!.type, value)),
  };
}

/**
 * `UPDATE … SET … WHERE <primary key> = ?` for the given attribute values. `storedKey` is
 * the key as stored in D1 (the row's key before any change to it), so it's bound as-is.
 */
export function compileUpdate(
  model: ModelClass<ModelBase>,
  assignments: readonly (readonly [attribute: string, value: unknown])[],
  storedKey: unknown,
): CompiledQuery {
  const params: unknown[] = [];
  const sets = assignments.map(([name, value]) => {
    const { column, type } = attributeOf(model, name);
    params.push(writeValue(type, value));
    return `${quoteIdentifier(column)} = ?`;
  });
  const primaryKey = attributeOf(model, model.primaryKey);
  params.push(storedKey);
  return {
    sql: `UPDATE ${quoteIdentifier(model.tableName)} SET ${sets.join(", ")} WHERE ${quoteIdentifier(primaryKey.column)} = ?`,
    params,
  };
}

/** The quoted columns for `attributes`, or `*` for every column. */
export function compileColumns(
  model: ModelClass<ModelBase>,
  attributes: readonly string[] | undefined,
): string {
  if (attributes === undefined) return "*";
  return attributes.map((name) => quoteIdentifier(attributeOf(model, name).column)).join(", ");
}

/**
 * Counts over the whole query as a subquery, so `count()` always equals the number of
 * rows `toArray()` would return (including limit, offset, select and distinct).
 * `count(attr)` counts non-null values, or distinct non-null values after `distinct()`.
 */
export function compileCount(query: SelectQuery, attribute?: string): CompiledQuery {
  if (attribute === undefined) {
    const inner = compileSelect(query);
    return { sql: `SELECT COUNT(*) AS count FROM (${inner.sql})`, params: inner.params };
  }
  const inner = compileSelect({ ...query, select: undefined, distinct: false });
  const column = quoteIdentifier(attributeOf(query.model, attribute).column);
  const counted = query.distinct ? `DISTINCT ${column}` : column;
  return { sql: `SELECT COUNT(${counted}) AS count FROM (${inner.sql})`, params: inner.params };
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
