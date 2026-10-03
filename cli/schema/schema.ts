import { DatabaseSync } from "node:sqlite";
import { convert, type Column, type Spec } from "./conventions.ts";

export interface Migration {
  /** The file's name, as Wrangler orders and records it. */
  name: string;
  sql: string;
}

/** One table, ready to generate: its attributes in column order. */
export interface TableSchema {
  name: string;
  primaryKey: string;
  /** The migration that created or last changed it. */
  lastChangedBy: string;
  attributes: Record<string, Spec>;
}

export type SchemaResult =
  | { ok: true; tables: TableSchema[]; notes: string[] }
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
  const db = new DatabaseSync(":memory:");
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

function isOwnTable(name: string, migrationsTable: string): boolean {
  return !name.startsWith("sqlite_") && !name.startsWith("_cf_") && name !== migrationsTable;
}

/** The columns `json_valid` checks in a table's definition: `CHECK (json_valid(settings))`. */
function jsonChecked(definition: string): Set<string> {
  const pattern = /json_valid\(\s*["`[]?(\w+)["`\]]?\s*\)/gi;
  return new Set([...definition.matchAll(pattern)].map(([, name]) => name!));
}

/** The declared type of each column a foreign key references, by the referencing column. */
function referencedTypes(db: DatabaseSync, table: string): Map<string, string> {
  const keys = db
    .prepare('SELECT "from", "table", "to" FROM pragma_foreign_key_list(?)')
    .all(table);
  const types = new Map<string, string>();
  for (const key of keys) {
    const columns = db
      .prepare("SELECT name, type FROM pragma_table_info(?)")
      .all(String(key.table));
    const target = columns.find((column) => column.name === (key.to ?? "id"));
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

/** One table's schema, or the errors that stop it from being generated. */
function tableSchema(
  columns: Column[],
  lastChangedBy: string,
): { table?: TableSchema; errors: string[]; notes: string[] } {
  const name = columns[0]!.table;
  const keys = columns.filter((column) => column.primaryKey).map((column) => column.name);
  if (keys.length > 1) {
    const list = keys.join(", ");
    return {
      errors: [
        `${name}: a composite primary key (${list}) isn't supported; give the table a single key`,
      ],
      notes: [],
    };
  }
  const errors: string[] = [];
  const notes: string[] = [];
  const attributes: Record<string, Spec> = {};
  for (const column of columns) {
    const converted = convert(column);
    if (!converted.ok) errors.push(converted.error);
    else {
      attributes[converted.attribute] = converted.spec;
      if (converted.note !== undefined) notes.push(converted.note);
    }
  }
  const primaryKey = keys[0] ?? "id";
  return { table: { name, primaryKey, lastChangedBy, attributes }, errors, notes };
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
  const tables: TableSchema[] = [];
  const errors: string[] = [];
  const notes: string[] = [];
  const own = [...definitions(db)].filter(([name]) => isOwnTable(name, migrationsTable));
  for (const [name, definition] of own.sort(([a], [b]) => a.localeCompare(b))) {
    const result = tableSchema(columnsOf(db, name, definition), changedBy.get(name)!);
    errors.push(...result.errors);
    notes.push(...result.notes);
    if (result.table !== undefined) tables.push(result.table);
  }
  db.close();
  return errors.length > 0 ? { ok: false, errors } : { ok: true, tables, notes };
}
