import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pluralize } from "../../src/inflections.ts";
import { camelize, underscore } from "../../src/naming.ts";
import { generateSchema } from "../schema/command.ts";
import { migrationsOf, shown, targetsOf, type Print, type Target } from "../schema/project.ts";
import { schemaOf, type GeneratedTable, type Migration } from "../schema/schema.ts";
import { parseColumns, type ColumnArg } from "./columns.ts";
import { migrationFileName, migrationFor } from "./migration.ts";
import { appendModel, modelFileName, modelSource, type ModelToWrite } from "./model-file.ts";

export interface GenerateOptions {
  /** The project's folder; the current one by default. */
  cwd?: string;
  /** The Wrangler config file, in place of finding it. */
  config?: string;
  /** The D1 binding to generate for, when the config has several. */
  database?: string;
  kind: "model" | "migration";
  /** The Model's class name, or the migration's name. */
  name: string;
  columns: readonly string[];
  /** `--id integer`: a key D1 generates, in place of a `TEXT` key made in code. */
  integerId?: boolean;
  /** `--no-timestamps` sets this false. */
  timestamps?: boolean;
  /** Where Model files go (`src/models`), or one file they're all appended to (`src/models.ts`). */
  models?: string;
}

/** A file the generator will write: where, and what. */
interface FileToWrite {
  path: string;
  source: string;
}

/** Everything a generator writes, once it's been checked. */
interface Generated {
  target: Target;
  migration: FileToWrite;
  model?: FileToWrite;
  notes: string[];
}

/** Why nothing was written: a problem with the setup, or with what was asked for. */
type Refusal = { setup: string } | { errors: string[] };

/** A class name from any spelling: `line_item`, `lineItem` → `LineItem`. */
function classify(name: string): string {
  const camel = camelize(underscore(name));
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

/** `"A"`, `"A or B"`, `"A, B or C"`. */
function listed(names: readonly string[]): string {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
}

/** The database to generate for: the only one, or the one `--database` names. */
function targetFor(cwd: string, options: GenerateOptions): Target | string {
  const targets = targetsOf(cwd, { config: options.config });
  if (typeof targets === "string") return targets;
  const bindings = listed(targets.map((target) => target.database.binding));
  if (options.database !== undefined) {
    const target = targets.find((each) => each.database.binding === options.database);
    return target ?? `No D1 database is bound as ${options.database}; this config has ${bindings}`;
  }
  return targets.length === 1
    ? targets[0]!
    : `This config has several D1 databases; choose one with --database (${bindings})`;
}

/** Wrangler only applies migrations its `migrations_pattern` matches, so refuse any other file. */
function patternRefusal(cwd: string, target: Target, path: string): string | undefined {
  const pattern = target.database.migrationsPattern;
  const relativePath = relative(target.configDir, path).split(sep).join("/");
  if (
    pattern === undefined ||
    process.getBuiltinModule("node:path").matchesGlob(relativePath, pattern)
  ) {
    return undefined;
  }
  return (
    `${shown(cwd, path)} wouldn't match migrations_pattern (${pattern}), so Wrangler wouldn't ` +
    "apply it; write the migration with your migration tool instead"
  );
}

/** Each table's key type (`TEXT`, `INTEGER`), for the columns that reference it. */
function keyTypes(tables: readonly GeneratedTable[]): Map<string, string> {
  return new Map(
    tables.map((table) => {
      const spec = table.attributes[table.primaryKey]!;
      return [table.name, spec.type === "integer" ? "INTEGER" : "TEXT"];
    }),
  );
}

/** A module path from one file's folder to another file, as an import writes it (`../db/schema`). */
function importPath(fromDir: string, to: string): string {
  const path = relative(fromDir, to).split(sep).join("/").replace(/\.ts$/, "");
  return path.startsWith(".") ? path : `./${path}`;
}

/** The Model `g model` writes, and where; or why it can't. */
function modelFile(
  cwd: string,
  target: Target,
  options: GenerateOptions,
  columns: readonly ColumnArg[],
): FileToWrite | string {
  const className = classify(options.name);
  const models = options.models ?? "src/models";
  const separateFiles = !models.endsWith(".ts");
  const path = separateFiles
    ? resolve(cwd, models, modelFileName(className))
    : resolve(cwd, models);
  const model: ModelToWrite = {
    className,
    table: pluralize(underscore(className)),
    associations: columns
      .filter((column) => column.type === "references")
      .map((column) => ({ name: column.association!, className: classify(column.association!) })),
    schemaImport: importPath(dirname(path), target.out),
  };
  const existing = existsSync(path) ? readFileSync(path, "utf8") : undefined;
  if (existing !== undefined && separateFiles) return `${shown(cwd, path)} already exists`;
  if (existing !== undefined && new RegExp(`^export class ${className}\\b`, "m").test(existing)) {
    return `${shown(cwd, path)} already has ${className}`;
  }
  const source =
    existing === undefined ? modelSource(model, { separateFiles }) : appendModel(existing, model);
  return { path, source };
}

/** Notes for references to tables the migrations don't make yet: their key type is a guess. */
function referenceNotes(
  columns: readonly ColumnArg[],
  keys: ReadonlyMap<string, string>,
): string[] {
  return columns
    .filter((column) => column.type === "references" && !keys.has(column.references!))
    .map((column) => `${column.references} isn't in the migrations yet, so ${column.name} is TEXT`);
}

/** The migration, checked by applying it after the others in memory; or why it was refused. */
function checkedMigration(
  target: Target,
  options: GenerateOptions,
  columns: readonly ColumnArg[],
  existing: readonly Migration[],
): { migration: FileToWrite; notes: string[] } | Refusal {
  const current = schemaOf(existing, { migrationsTable: target.database.migrationsTable });
  if (!current.ok) return { errors: current.errors };
  const keys = keyTypes(current.tables);
  const stem =
    options.kind === "model"
      ? `create_${pluralize(underscore(classify(options.name)))}`
      : options.name;
  const name = migrationFileName(
    existing.map((each) => each.name),
    stem,
  );
  const result = migrationFor(stem, columns, keys, options);
  if (!result.ok) return { errors: [result.error] };
  const after = schemaOf([...existing, { name, sql: result.sql }], {
    migrationsTable: target.database.migrationsTable,
  });
  if (!after.ok) return { errors: after.errors };
  return {
    migration: { path: join(target.migrationsDir, name), source: result.sql },
    notes: referenceNotes(columns, keys),
  };
}

/** Checks everything a generator would write, before anything is written. */
function prepared(cwd: string, options: GenerateOptions): Generated | Refusal {
  const target = targetFor(cwd, options);
  if (typeof target === "string") return { setup: target };
  const parsed = parseColumns(options.columns);
  if (!parsed.ok) return { errors: parsed.errors };
  const existing = existsSync(target.migrationsDir) ? migrationsOf(target) : [];
  let model: FileToWrite | undefined;
  if (options.kind === "model") {
    const file = modelFile(cwd, target, options, parsed.columns);
    if (typeof file === "string") return { errors: [file] };
    model = file;
  }
  const checked = checkedMigration(target, options, parsed.columns, existing);
  if (!("migration" in checked)) return checked;
  const refusal = patternRefusal(cwd, target, checked.migration.path);
  if (refusal !== undefined) return { setup: refusal };
  return { target, migration: checked.migration, model, notes: checked.notes };
}

/** Writes a file, making its folder, and says so. */
function write(cwd: string, file: FileToWrite, print: Print): void {
  mkdirSync(dirname(file.path), { recursive: true });
  writeFileSync(file.path, file.source);
  print(`Wrote ${shown(cwd, file.path)}`);
}

/**
 * `d1-record g model` and `g migration` (#66, #70): write a migration (and a Model), checked
 * against the existing migrations first, then regenerate the schema. Returns the exit code.
 */
export function runGenerate(options: GenerateOptions, print: Print): number {
  const cwd = resolve(options.cwd ?? process.cwd());
  const generated = prepared(cwd, options);
  if ("setup" in generated) {
    print(generated.setup);
    return 1;
  }
  if ("errors" in generated) {
    for (const error of generated.errors) print(error);
    print("Wrote nothing");
    return 1;
  }
  const { target, migration, model, notes } = generated;
  write(cwd, migration, print);
  if (model !== undefined) write(cwd, model, print);
  const code = generateSchema(cwd, target, false, print);
  for (const note of notes) print(`Note: ${note}`);
  print(
    `Next: npx wrangler d1 migrations apply ${target.database.databaseName ?? target.database.binding} --local`,
  );
  return code;
}
