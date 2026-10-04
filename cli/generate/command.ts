import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { generateSchema, schemaRefusal } from "../schema/command.ts";
import {
  importPath,
  migrationsOf,
  shown,
  slashed,
  targetsOf,
  type Print,
  type Target,
} from "../schema/project.ts";
import { schemaOf, type GeneratedTable, type Migration } from "../schema/schema.ts";
import { parseColumns, type ColumnArg } from "./columns.ts";
import { migrationFileName, migrationFor, type KeyType } from "./migration.ts";
import { appendModel, modelFileName, modelSource, type ModelToWrite } from "./model-file.ts";
import { classify } from "../schema/names.ts";
import { migrationNameError, modelName, tableize } from "./names.ts";

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

/** What's being generated, once the database and the columns are known. */
interface Request {
  cwd: string;
  target: Target;
  options: GenerateOptions;
  columns: readonly ColumnArg[];
  /** The Model's class, for `g model`. */
  className?: string;
}

/** A file the generator will write: where, and what. */
interface FileToWrite {
  path: string;
  source: string;
}

/** Everything a generator writes, once it's all been checked; or why nothing will be. */
type Plan =
  | { ok: true; target: Target; migration: FileToWrite; model?: FileToWrite; notes: string[] }
  | Refusal;

/**
 * Why nothing was written. `wroteNothing` is false for a problem with the project itself (its
 * config, or a database to choose), where "Wrote nothing" would say nothing useful.
 */
type Refusal = { ok: false; errors: string[]; wroteNothing: boolean };

/** Refuses with these errors, after which the command prints "Wrote nothing". */
function refused(...errors: string[]): Refusal {
  return { ok: false, errors, wroteNothing: true };
}

/** `"A"`, `"A or B"`, `"A, B or C"`. */
function listed(names: readonly string[]): string {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
}

/** The database to generate for: the only one, or the one `--database` names. */
function targetFor(cwd: string, options: GenerateOptions): Target | string {
  const targets = targetsOf(cwd, { config: options.config, models: options.models });
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
function patternRefusal({ cwd, target }: Request, path: string): string | undefined {
  const pattern = target.database.migrationsPattern;
  const relativePath = slashed(relative(target.configDir, path));
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

/** Each table's key type, for the columns that reference it. */
function keyTypes(tables: readonly GeneratedTable[]): Map<string, KeyType> {
  return new Map(
    tables.map((table) => {
      const spec = table.attributes[table.primaryKey]!;
      return [table.name, spec.type === "integer" ? "INTEGER" : "TEXT"];
    }),
  );
}

/** The Model `g model` writes, and where (its own file, or appended to one); or why it can't. */
function modelFile(request: Request): FileToWrite | Refusal {
  const { cwd, target, options, columns } = request;
  const className = request.className!;
  const models = options.models ?? "src/models";
  const separateFiles = !models.endsWith(".ts");
  const path = resolve(cwd, models, separateFiles ? modelFileName(className) : "");
  const model: ModelToWrite = {
    className,
    table: tableize(className),
    associations: columns
      .filter((column) => column.type === "references")
      .map((column) => ({ name: column.association!, className: classify(column.association!) })),
    base: {
      className: target.base.className,
      importPath: importPath(dirname(path), target.base.path),
    },
  };
  if (!existsSync(path)) return { path, source: modelSource(model, { separateFiles }) };
  const existing = readFileSync(path, "utf8");
  if (separateFiles) return refused(`${shown(cwd, path)} already exists`);
  if (new RegExp(`^export class ${className}\\b`, "m").test(existing)) {
    return refused(`${shown(cwd, path)} already has ${className}`);
  }
  const appended = appendModel(existing, model);
  return appended.ok
    ? { path, source: appended.source }
    : refused(`${shown(cwd, path)}: ${appended.error}`);
}

/** Notes for references to tables the migrations don't make yet: their key type is a guess. */
function referenceNotes(
  columns: readonly ColumnArg[],
  keys: ReadonlyMap<string, KeyType>,
): string[] {
  return columns
    .filter((column) => column.type === "references" && !keys.has(column.references!))
    .map((column) => `${column.references} isn't in the migrations yet, so ${column.name} is TEXT`);
}

/** The migration, checked by applying it after the others in memory; or why it was refused. */
function checkedMigration(
  request: Request,
  existing: readonly Migration[],
): { ok: true; migration: FileToWrite; notes: string[] } | Refusal {
  const { target, options, columns } = request;
  const migrationsTable = target.database.migrationsTable;
  const current = schemaOf(existing, { migrationsTable });
  if (!current.ok) return refused(...current.errors);
  const keys = keyTypes(current.tables);
  const stem =
    request.className === undefined ? options.name : `create_${tableize(request.className)}`;
  const name = migrationFileName(
    existing.map((each) => each.name),
    stem,
  );
  const result = migrationFor(stem, columns, keys, options);
  if (!result.ok) return refused(result.error);
  const after = schemaOf([...existing, { name, sql: result.sql }], { migrationsTable });
  if (!after.ok) return refused(...after.errors);
  const migration = { path: join(target.migrationsDir, name), source: result.sql };
  return { ok: true, migration, notes: referenceNotes(columns, keys) };
}

/** The request: the database, the columns and the names, each checked. */
function requestFor(
  cwd: string,
  options: GenerateOptions,
): (Request & { notes: string[] }) | Refusal {
  const target = targetFor(cwd, options);
  if (typeof target === "string") return { ok: false, errors: [target], wroteNothing: false };
  // Checked first, so a generator never writes a migration whose schema it then can't write.
  const refusal = schemaRefusal(cwd, target);
  if (refusal !== undefined) return refused(refusal);
  const parsed = parseColumns(options.columns);
  if (!parsed.ok) return refused(...parsed.errors);
  const request = { cwd, target, options, columns: parsed.columns, notes: [] as string[] };
  if (options.kind === "migration") {
    const error = migrationNameError(options.name);
    return error === undefined ? request : refused(error);
  }
  const model = modelName(options.name);
  if (!model.ok) return refused(model.error);
  if (model.note !== undefined) request.notes.push(model.note);
  return { ...request, className: model.className };
}

/** Checks everything a generator would write, before anything is written. */
function planFor(cwd: string, options: GenerateOptions): Plan {
  const request = requestFor(cwd, options);
  if ("ok" in request) return request;
  const existing = existsSync(request.target.migrationsDir) ? migrationsOf(request.target) : [];
  const model = request.className === undefined ? undefined : modelFile(request);
  if (model !== undefined && "ok" in model) return model;
  const checked = checkedMigration(request, existing);
  if (!checked.ok) return checked;
  const refusal = patternRefusal(request, checked.migration.path);
  if (refusal !== undefined) return { ok: false, errors: [refusal], wroteNothing: false };
  const notes = [...request.notes, ...checked.notes];
  return { ok: true, target: request.target, migration: checked.migration, model, notes };
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
  const plan = planFor(cwd, options);
  if (!plan.ok) {
    for (const error of plan.errors) print(error);
    if (plan.wroteNothing) print("Wrote nothing");
    return 1;
  }
  const { target, migration, model, notes } = plan;
  write(cwd, migration, print);
  if (model !== undefined) write(cwd, model, print);
  const code = generateSchema(cwd, target, false, print);
  for (const note of notes) print(`Note: ${note}`);
  const database = target.database.databaseName ?? target.database.binding;
  print(`Next: npx wrangler d1 migrations apply ${database} --local`);
  return code;
}
