import type { DatabaseSync } from "node:sqlite";
import { convert, type Column, type Spec } from "./conventions.ts";
import { exportName } from "./names.ts";

export interface Migration {
  /** The file's name, as Wrangler orders and records it. */
  name: string;
  sql: string;
}

/** One table, ready to generate: its attributes in column order. */
export interface GeneratedTable {
  name: string;
  /** The `const` it's exported as in the generated file. */
  exportName: string;
  primaryKey: string;
  /** The migration that created or last changed it. */
  lastChangedBy: string;
  attributes: Record<string, Spec>;
}

export type SchemaResult =
  | { ok: true; tables: GeneratedTable[]; notes: string[] }
  | { ok: false; errors: string[] };

interface Options {
  /** Wrangler's record of applied migrations (`migrations_table`), left out of the schema. */
  migrationsTable?: string;
}

/** Each table's definition (`CREATE TABLE …`), by name. */
function definitions(db: DatabaseSync): Map<string, string> {
  const rows = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table'").all();
  return new Map(rows.map((row) => [String(row.name), String(row.sql)]));
}

/**
 * Applies the migrations in order to an in-memory SQLite database, noting which one last
 * changed each table. A migration that fails is reported by its file name.
 */
function applied(migrations: readonly Migration[]): {
  db?: DatabaseSync;
  changedBy: Map<string, string>;
  error?: string;
} {
  // Loaded when used, so a Node without node:sqlite gets the command's own message (cli/main.ts).
  const { DatabaseSync: Database } = process.getBuiltinModule("node:sqlite");
  const db = new Database(":memory:");
  const changedBy = new Map<string, string>();
  let before = definitions(db);
  for (const { name, sql } of migrations) {
    try {
      db.exec(sql);
    } catch (error) {
      return { changedBy, error: `${name}: ${(error as Error).message}` };
    }
    const after = definitions(db);
    for (const [table, definition] of after) {
      if (before.get(table) !== definition) changedBy.set(table, name);
    }
    before = after;
  }
  return { db, changedBy };
}

/** Plain character order, the same on every machine (unlike `localeCompare`). */
export function byName(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The tables a Model can be built on: not SQLite's, Cloudflare's or Wrangler's own, and not a
 * virtual table (full-text search, say) or the shadow tables SQLite keeps for one.
 */
function ownTables(all: Map<string, string>, migrationsTable: string): [string, string][] {
  const virtual = [...all]
    .filter(([, sql]) => /^CREATE\s+VIRTUAL\s+TABLE/i.test(sql))
    .map(([name]) => name);
  const shadow = (name: string) =>
    virtual.some((table) => name === table || name.startsWith(`${table}_`));
  const internal = (name: string) =>
    name.startsWith("sqlite_") || name.startsWith("_cf_") || name === migrationsTable;
  return [...all].filter(([name]) => !internal(name) && !shadow(name));
}

/** The columns `json_valid` checks in a table's definition: `CHECK (json_valid(settings))`. */
function jsonChecked(definition: string): Set<string> {
  const pattern = /json_valid\(\s*(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|(\w+))\s*\)/gi;
  return new Set([...definition.matchAll(pattern)].map((match) => match.slice(1).find(Boolean)!));
}

/** The declared type of each column a foreign key references, by the referencing column. */
function referencedTypes(db: DatabaseSync, table: string): Map<string, string> {
  const keys = db
    .prepare('SELECT "from", "table", "to" FROM pragma_foreign_key_list(?)')
    .all(table);
  const types = new Map<string, string>();
  for (const key of keys) {
    const columns = db
      .prepare("SELECT name, type, pk FROM pragma_table_info(?)")
      .all(String(key.table));
    // A key that names no column points at the parent's primary key.
    const target = columns.find((column) =>
      key.to === null ? Number(column.pk) > 0 : column.name === key.to,
    );
    if (target !== undefined) types.set(String(key.from), String(target.type));
  }
  return types;
}

/** A table's columns, as the conventions read them. */
function columnsOf(db: DatabaseSync, table: string, definition: string): Column[] {
  const json = jsonChecked(definition);
  const referenced = referencedTypes(db, table);
  return db
    .prepare('SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info(?)')
    .all(table)
    .map((row) => ({
      table,
      name: String(row.name),
      declaredType: String(row.type),
      notNull: row.notnull === 1,
      defaultValue: row.dflt_value === null ? null : String(row.dflt_value),
      primaryKey: Number(row.pk) > 0,
      jsonChecked: json.has(String(row.name)),
      referencedType: referenced.get(String(row.name)),
    }));
}

/** Why a table's primary key won't do: none, or more than one column. */
function keyError(name: string, keys: readonly string[]): string | undefined {
  if (keys.length === 0) {
    return `${name}: no primary key; d1-record needs one (id INTEGER PRIMARY KEY, or id TEXT PRIMARY KEY)`;
  }
  if (keys.length > 1) {
    return `${name}: a composite primary key (${keys.join(", ")}) isn't supported; give the table a single key`;
  }
  return undefined;
}

/** A table's attributes, in column order, with the errors and notes their columns raise. */
function attributesOf(columns: readonly Column[]): {
  attributes: Record<string, Spec>;
  errors: string[];
  notes: string[];
} {
  const attributes: Record<string, Spec> = {};
  const errors: string[] = [];
  const notes: string[] = [];
  const columnOf = new Map<string, string>();
  for (const column of columns) {
    const converted = convert(column);
    if (!converted.ok) {
      errors.push(converted.error);
      continue;
    }
    const { attribute, spec, note } = converted;
    const taken = columnOf.get(attribute);
    if (taken !== undefined) {
      errors.push(
        `${column.table}: columns ${taken} and ${column.name} would both be the attribute ${attribute}; rename one`,
      );
    }
    columnOf.set(attribute, column.name);
    attributes[attribute] = spec;
    if (note !== undefined) notes.push(note);
  }
  return { attributes, errors, notes };
}

/** One table's schema, or the errors that stop it from being generated. */
function tableSchema(
  columns: Column[],
  lastChangedBy: string,
): { table?: GeneratedTable; errors: string[]; notes: string[] } {
  const name = columns[0]!.table;
  const keys = columns.filter((column) => column.primaryKey).map((column) => column.name);
  const error = keyError(name, keys);
  if (error !== undefined) return { errors: [error], notes: [] };
  const { attributes, errors, notes } = attributesOf(columns);
  const table = {
    name,
    exportName: exportName(name),
    primaryKey: keys[0]!,
    lastChangedBy,
    attributes,
  };
  return { table, errors, notes };
}

/** Tables whose names become the same export (`line_items`, `line-items` → `lineItems`). */
function exportCollisions(names: readonly string[]): string[] {
  const seen = new Map<string, string>();
  const errors: string[] = [];
  for (const name of names) {
    const as = exportName(name);
    const other = seen.get(as);
    if (other !== undefined) {
      errors.push(`${other} and ${name} would both be exported as ${as}; rename one of the tables`);
    }
    seen.set(as, name);
  }
  return errors;
}

/**
 * The tables a project's migrations make, by d1-record's conventions (#66): applied in order to
 * an in-memory SQLite database (`node:sqlite`), then read column by column. Tables are in
 * alphabetical order and columns in the table's order, so the result only changes with the
 * schema. SQLite's, Cloudflare's and Wrangler's own tables, and views, are left out.
 */
export function schemaOf(migrations: readonly Migration[], options: Options = {}): SchemaResult {
  const { db, changedBy, error } = applied(migrations);
  if (db === undefined) return { ok: false, errors: [error!] };
  const migrationsTable = options.migrationsTable ?? "d1_migrations";
  const tables: GeneratedTable[] = [];
  const errors: string[] = [];
  const notes: string[] = [];
  const own = ownTables(definitions(db), migrationsTable).sort(([a], [b]) => byName(a, b));
  errors.push(...exportCollisions(own.map(([name]) => name)));
  for (const [name, definition] of own) {
    const result = tableSchema(columnsOf(db, name, definition), changedBy.get(name)!);
    errors.push(...result.errors);
    notes.push(...result.notes);
    if (result.table !== undefined) tables.push(result.table);
  }
  db.close();
  return errors.length > 0 ? { ok: false, errors } : { ok: true, tables, notes };
}
