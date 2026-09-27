import { attributeOf, type AttributeDefinition } from "./metadata.ts";
import type { ModelBase, ModelClass } from "./model.ts";
import { Comparison } from "./comparisons.ts";
import { Either, Negated, type Condition, type QueryDescription } from "./query.ts";
import { ColumnReference, SafeSql } from "./sql.ts";
import { writeUntypedValue, writeValue } from "./conversion.ts";

/** One SQL statement ready for D1, with the Model whose table it reads or writes. */
export interface CompiledSql {
  sql: string;
  params: unknown[];
  model: ModelClass<ModelBase>;
}

/** Quotes a SQLite identifier; embedded double quotes are doubled. */
function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** `projection` is the SELECT list; the library builds it, never the caller. */
export function compileSelect(query: QueryDescription, projection?: string): CompiledSql {
  const params: unknown[] = [];
  const list = projection ?? compileColumns(query.model, query.select);
  let sql = `SELECT ${query.distinct ? "DISTINCT " : ""}${list}`;
  sql += ` FROM ${quoteIdentifier(query.model.tableName)}`;
  sql += compileWhere(query, params);
  sql += compileOrder(query);
  sql += compilePagination(query, params);
  return { sql, params, model: query.model };
}

function compileWhere({ model, conditions }: QueryDescription, params: unknown[]): string {
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
    value instanceof Comparison
      ? compileComparison(attributeOf(model, name), value, params)
      : compileEquality(attributeOf(model, name), value, params),
  );
  return `(${parts.join(" AND ")})`;
}

/** An attribute and the value to write to it. */
export type Assignment = readonly [attribute: string, value: unknown];

/** `INSERT … RETURNING *` for the given attribute values, or `DEFAULT VALUES` for none. */
export function compileInsert(
  model: ModelClass<ModelBase>,
  assignments: readonly Assignment[],
): CompiledSql {
  const table = quoteIdentifier(model.tableName);
  if (assignments.length === 0) {
    return { sql: `INSERT INTO ${table} DEFAULT VALUES RETURNING *`, params: [], model };
  }
  const definitions = assignments.map(([name]) => attributeOf(model, name));
  const columns = definitions.map(({ column }) => quoteIdentifier(column)).join(", ");
  const placeholders = assignments.map(() => "?").join(", ");
  return {
    sql: `INSERT INTO ${table} (${columns}) VALUES (${placeholders}) RETURNING *`,
    params: assignments.map(([, value], index) => writeValue(definitions[index]!.type, value)),
    model,
  };
}

/**
 * `UPDATE … SET … WHERE <primary key> = ?` for the given attribute values. `storedKey` is
 * the key as stored in D1 (the row's key before any change to it), so it's bound as-is.
 */
export function compileUpdate(
  model: ModelClass<ModelBase>,
  assignments: readonly Assignment[],
  storedKey: unknown,
): CompiledSql {
  const params: unknown[] = [];
  const sets = compileSets(model, assignments, params);
  const primaryKey = attributeOf(model, model.primaryKey);
  params.push(storedKey);
  return {
    sql: `UPDATE ${quoteIdentifier(model.tableName)} SET ${sets} WHERE ${quoteIdentifier(primaryKey.column)} = ?`,
    params,
    model,
  };
}

/** `"col" = ?, …` for attribute values, or an `sql` fragment's own text. */
function compileSets(
  model: ModelClass<ModelBase>,
  changes: readonly Assignment[] | SafeSql,
  params: unknown[],
): string {
  if (changes instanceof SafeSql) return compileFragment(changes, model, params);
  return changes
    .map(([name, value]) => {
      const { column, type } = attributeOf(model, name);
      params.push(writeValue(type, value));
      return `${quoteIdentifier(column)} = ?`;
    })
    .join(", ");
}

/**
 * The WHERE clause for writing to the rows `query` describes, as Rails does it: its conditions;
 * with a limit or offset, `<primary key> IN (SELECT <primary key> … ORDER … LIMIT … OFFSET)`;
 * `1 = 0` for `none()`. Order without a limit, select and includes don't matter to a write.
 */
function compileTarget(query: QueryDescription, params: unknown[]): string {
  if (query.none) return " WHERE 1 = 0";
  if (query.limit === undefined && query.offset === undefined) return compileWhere(query, params);
  const key = quoteIdentifier(attributeOf(query.model, query.model.primaryKey).column);
  const inner = compileSelect({ ...query, distinct: false }, key);
  params.push(...inner.params);
  return ` WHERE ${key} IN (${inner.sql})`;
}

/** `UPDATE … SET … WHERE …` for every row `query` describes. */
export function compileUpdateAll(
  query: QueryDescription,
  changes: readonly Assignment[] | SafeSql,
): CompiledSql {
  const params: unknown[] = [];
  const sets = compileSets(query.model, changes, params);
  const target = compileTarget(query, params);
  const sql = `UPDATE ${quoteIdentifier(query.model.tableName)} SET ${sets}${target}`;
  return { sql, params, model: query.model };
}

/** `DELETE … WHERE …` for every row `query` describes. */
export function compileDeleteAll(query: QueryDescription): CompiledSql {
  const params: unknown[] = [];
  const target = compileTarget(query, params);
  const sql = `DELETE FROM ${quoteIdentifier(query.model.tableName)}${target}`;
  return { sql, params, model: query.model };
}

/** `DELETE … WHERE <primary key> = ?`, with the key as stored in D1. */
export function compileDelete(model: ModelClass<ModelBase>, storedKey: unknown): CompiledSql {
  const { column } = attributeOf(model, model.primaryKey);
  return {
    sql: `DELETE FROM ${quoteIdentifier(model.tableName)} WHERE ${quoteIdentifier(column)} = ?`,
    params: [storedKey],
    model,
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
export function compileCount(query: QueryDescription, attribute?: string): CompiledSql {
  if (attribute === undefined) {
    const inner = compileSelect(query);
    return { ...inner, sql: `SELECT COUNT(*) AS count FROM (${inner.sql})` };
  }
  const inner = compileSelect({ ...query, select: undefined, distinct: false });
  const column = quoteIdentifier(attributeOf(query.model, attribute).column);
  const counted = query.distinct ? `DISTINCT ${column}` : column;
  return { ...inner, sql: `SELECT COUNT(${counted}) AS count FROM (${inner.sql})` };
}

/** `attr >= ?`, `attr BETWEEN ? AND ?`, …, with the values converted like the attribute's. */
function compileComparison(
  attribute: AttributeDefinition,
  { operator, values }: Comparison,
  params: unknown[],
): string {
  const column = quoteIdentifier(attribute.column);
  params.push(...values.map((value) => writeValue(attribute.type, value)));
  switch (operator) {
    case "between":
      return `${column} BETWEEN ? AND ?`;
    case "from":
      return `(${column} >= ? AND ${column} < ?)`;
    default:
      return `${column} ${operator} ?`;
  }
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

function compileOrder({ model, order }: QueryDescription): string {
  if (order.length === 0) return "";
  const terms = order.map(
    ({ attribute, direction }) =>
      `${quoteIdentifier(attributeOf(model, attribute).column)} ${direction.toUpperCase()}`,
  );
  return ` ORDER BY ${terms.join(", ")}`;
}

function compilePagination({ limit, offset }: QueryDescription, params: unknown[]): string {
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
