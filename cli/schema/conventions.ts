import { camelize, underscore } from "../../src/naming.ts";

export type AttributeType = "string" | "integer" | "real" | "boolean" | "datetime" | "json";

/** A default the generated spec carries: a literal, or a key generated in code. */
export type Default = { literal: string | number | boolean } | { generated: "uuid" };

/** One attribute as the generated schema declares it, the shape `Model({...})` takes. */
export interface Spec {
  type: AttributeType;
  null?: false;
  column?: string;
  default?: Default;
}

/** One column as SQLite describes it (`pragma_table_info`), with what the table adds to it. */
export interface Column {
  table: string;
  name: string;
  declaredType: string;
  notNull: boolean;
  defaultValue: string | null;
  primaryKey: boolean;
  /** Checked with `json_valid` in the table's definition. */
  jsonChecked: boolean;
  /** The declared type of the column a foreign key references, if it has one. */
  referencedType: string | undefined;
}

/** What a column became, or why it can't be one, plus a note when its type was guessed. */
export type Converted =
  | { ok: true; attribute: string; spec: Spec; note?: string }
  | { ok: false; error: string };

const declaredTypes: readonly (readonly [RegExp, AttributeType])[] = [
  [/^BOOL/, "boolean"],
  [/^(DATETIME|TIMESTAMP|DATE)$/, "datetime"],
  [/^JSON$/, "json"],
  [/INT/, "integer"],
  [/CHAR|CLOB|TEXT/, "string"],
  [/REAL|FLOA|DOUB/, "real"],
];

/** The declared type's name, without its size or precision: `VARCHAR(40)` → `VARCHAR`. */
function baseType(declared: string): string {
  return declared
    .toUpperCase()
    .replace(/\(.*\)/, "")
    .trim();
}

/** A column's attribute type: its declared type first, then its name for plain TEXT/INTEGER. */
function typeOf(column: Column): { type?: AttributeType; error?: string; note?: string } {
  const declared = baseType(column.declaredType || (column.referencedType ?? ""));
  const where = `${column.table}.${column.name}`;
  if (/^(NUMERIC|DECIMAL)$/.test(declared)) {
    return {
      error: `${where}: ${declared} loses precision as a number; store money as integer cents (${column.name}_cents INTEGER)`,
    };
  }
  if (declared === "BLOB") return { error: `${where}: BLOB columns aren't supported yet (#20)` };
  const type = declaredTypes.find(([pattern]) => pattern.test(declared))?.[1] ?? "string";
  return refinedByName(column, type, where);
}

/** A plain TEXT or INTEGER refined by the column's checks and name (Rails' conventions). */
function refinedByName(
  column: Column,
  type: AttributeType,
  where: string,
): { type: AttributeType; note?: string } {
  if (type === "string" && column.jsonChecked) return { type: "json" };
  if (type === "string" && column.name.endsWith("_at")) return { type: "datetime" };
  const prefix = /^(is|has)_/.exec(column.name)?.[1];
  if (type === "integer" && prefix !== undefined && !column.primaryKey) {
    return { type: "boolean", note: `${where}: INTEGER read as boolean, from its ${prefix}_ name` };
  }
  return { type };
}

/** A SQL literal default as a value of the attribute's type; undefined for anything else. */
export function literalDefault(text: string | null, type: AttributeType): Default | undefined {
  if (text === null) return undefined;
  const value = text.trim();
  if (type === "boolean") {
    if (/^(TRUE|1)$/i.test(value)) return { literal: true };
    if (/^(FALSE|0)$/i.test(value)) return { literal: false };
    return undefined;
  }
  if ((type === "integer" || type === "real") && /^-?\d+(\.\d+)?$/.test(value)) {
    return { literal: Number(value) };
  }
  if (type === "string" && /^'(?:[^']|'')*'$/.test(value)) {
    return { literal: value.slice(1, -1).replaceAll("''", "'") };
  }
  return undefined;
}

/** A column as an attribute, by the conventions (#66): name, type, nullability and default. */
export function convert(column: Column): Converted {
  const { type, error, note } = typeOf(column);
  if (type === undefined) return { ok: false, error: error! };
  const attribute = camelize(column.name);
  const spec: Spec = { type };
  if (column.notNull || column.primaryKey) spec.null = false;
  if (underscore(attribute) !== column.name) spec.column = column.name;
  const fallback =
    column.primaryKey && type === "string" ? { generated: "uuid" as const } : undefined;
  const defaultValue = column.primaryKey ? fallback : literalDefault(column.defaultValue, type);
  if (defaultValue !== undefined) spec.default = defaultValue;
  return note === undefined ? { ok: true, attribute, spec } : { ok: true, attribute, spec, note };
}
