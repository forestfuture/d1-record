import type { AttributeDefinition, ModelBase, ModelClass } from "./model.ts";
import { ColumnReference, SafeSql } from "./sql.ts";
import { writeValue } from "./types.ts";

export interface CompiledQuery {
  sql: string;
  params: unknown[];
}

export interface SelectQuery {
  model: ModelClass<ModelBase>;
  conditions: readonly Condition[];
}

export type Condition = Record<string, unknown> | SafeSql;

/** Quotes a SQLite identifier; embedded double quotes are doubled. */
export function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export function compileSelect({ model, conditions }: SelectQuery): CompiledQuery {
  const params: unknown[] = [];
  const predicates: string[] = [];
  for (const condition of conditions) {
    if (condition instanceof SafeSql) {
      predicates.push(`(${compileFragment(condition, model, params)})`);
      continue;
    }
    for (const [name, value] of Object.entries(condition)) {
      const attribute = attributeOf(model, name);
      predicates.push(`${quoteIdentifier(attribute.column)} = ?`);
      params.push(writeValue(attribute.type, value));
    }
  }
  let sql = `SELECT * FROM ${quoteIdentifier(model.tableName)}`;
  if (predicates.length > 0) sql += ` WHERE ${predicates.join(" AND ")}`;
  return { sql, params };
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
      params.push(bindable(value));
      text += "?";
    }
    text += fragment.strings[index + 1] ?? "";
  });
  return text;
}

/** Converts a value with no declared attribute type the way attributes are stored. */
function bindable(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

function attributeOf(model: ModelClass<ModelBase>, name: string): AttributeDefinition {
  const attribute = model.attributeDefinitions.get(name);
  if (attribute === undefined) throw new Error(`Unknown attribute "${name}"`);
  return attribute;
}
