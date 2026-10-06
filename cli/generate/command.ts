import { dirname, join, relative, resolve } from "node:path";
import { apply, type FileToWrite, type Plan } from "../plan.ts";
import { schemaRefusal, schemaWrites } from "../schema/command.ts";
import {
  defaultModels,
  importPath,
  shown,
  slashed,
  type Print,
  type Target,
} from "../schema/project.ts";
import { schemaOf, type GeneratedTable, type Migration } from "../schema/schema.ts";
import { readProject, type DatabaseSnapshot, type ProjectSnapshot } from "../schema/snapshot.ts";
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
  /** The schema file to regenerate (or, with several databases, the folder), as for `schema`. */
  out?: string;
}

/** The tables a set of migrations makes, and the notes their columns raise. */
type SchemaTables = { tables: GeneratedTable[]; notes: string[] };

/** What's being generated, once the database and the columns are known. */
interface Request {
  project: ProjectSnapshot;
  db: DatabaseSnapshot;
  target: Target;
  options: GenerateOptions;
  columns: readonly ColumnArg[];
  /** The Model's class, for `g model`. */
  className?: string;
}

/** Everything a generator writes, once it's all been checked; or why nothing will be. */
type Checked =
  | {
      ok: true;
      request: Request;
      migration: FileToWrite;
      model?: FileToWrite;
      schema: SchemaTables;
      notes: string[];
    }
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
function databaseFor(
  project: ProjectSnapshot,
  options: GenerateOptions,
): DatabaseSnapshot | string {
  const { databases } = project;
  const bindings = listed(databases.map((db) => db.target.database.binding));
  if (options.database !== undefined) {
    const db = databases.find((each) => each.target.database.binding === options.database);
    return db ?? `No D1 database is bound as ${options.database}; this config has ${bindings}`;
  }
  return databases.length === 1
    ? databases[0]!
    : `This config has several D1 databases; choose one with --database (${bindings})`;
}

/** Wrangler only applies migrations its `migrations_pattern` matches, so refuse any other file. */
function patternRefusal({ project, target }: Request, path: string): string | undefined {
  const pattern = target.database.migrationsPattern;
  const relativePath = slashed(relative(target.configDir, path));
  if (
    pattern === undefined ||
    process.getBuiltinModule("node:path").matchesGlob(relativePath, pattern)
  ) {
    return undefined;
  }
  return (
    `${shown(project.cwd, path)} wouldn't match migrations_pattern (${pattern}), so Wrangler wouldn't ` +
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

/** Where `g model` writes a Model: its own file, or the one file Models are appended to. */
function modelPathOf(cwd: string, options: GenerateOptions, className: string): string {
  const models = options.models ?? defaultModels;
  return resolve(cwd, models, models.endsWith(".ts") ? "" : modelFileName(className));
}

/** The Model `g model` writes, and where (its own file, or appended to one); or why it can't. */
function modelFile(request: Request): FileToWrite | Refusal {
  const { project, target, options, columns } = request;
  const { cwd } = project;
  const className = request.className!;
  const separateFiles = !(options.models ?? defaultModels).endsWith(".ts");
  const path = modelPathOf(cwd, options, className);
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
  const existing = project.files.get(path);
  if (existing === undefined) return { path, source: modelSource(model, { separateFiles }) };
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
):
  | { ok: true; migration: FileToWrite; after: Migration[]; schema: SchemaTables; notes: string[] }
  | Refusal {
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
  const after = [...existing, { name, sql: result.sql }];
  const checked = schemaOf(after, { migrationsTable });
  if (!checked.ok) return refused(...checked.errors);
  const migration = { path: join(target.migrationsDir, name), source: result.sql };
  return { ok: true, migration, after, schema: checked, notes: referenceNotes(columns, keys) };
}

/** The request: the database, the columns and the names, each checked. */
function requestFor(
  project: ProjectSnapshot,
  options: GenerateOptions,
): (Request & { notes: string[] }) | Refusal {
  const db = databaseFor(project, options);
  if (typeof db === "string") return { ok: false, errors: [db], wroteNothing: false };
  // Checked first, so a generator never plans a migration whose schema it then can't write.
  const refusal = schemaRefusal(project.cwd, db);
  if (refusal !== undefined) return refused(refusal);
  const parsed = parseColumns(options.columns);
  if (!parsed.ok) return refused(...parsed.errors);
  const { target } = db;
  const request = { project, db, target, options, columns: parsed.columns, notes: [] as string[] };
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
function checkedFor(project: ProjectSnapshot, options: GenerateOptions): Checked {
  const request = requestFor(project, options);
  if ("ok" in request) return request;
  const existing = request.db.migrations ?? [];
  const model = request.className === undefined ? undefined : modelFile(request);
  if (model !== undefined && "ok" in model) return model;
  const checked = checkedMigration(request, existing);
  if (!checked.ok) return checked;
  const refusal = patternRefusal(request, checked.migration.path);
  if (refusal !== undefined) return { ok: false, errors: [refusal], wroteNothing: false };
  const notes = [...request.notes, ...checked.notes];
  // The schema is planned from the migrations as they'll be, the new one included.
  request.db = { ...request.db, migrations: checked.after };
  const { migration, schema } = checked;
  return { ok: true, request, migration, model, schema, notes };
}

/**
 * What `g model` or `g migration` writes and prints for a project: a migration (and a Model),
 * checked against the existing migrations, then the schema regenerated with it.
 */
export function planGenerate(project: ProjectSnapshot, options: GenerateOptions): Plan {
  const checked = checkedFor(project, options);
  if (!checked.ok) {
    const lines = checked.wroteNothing ? [...checked.errors, "Wrote nothing"] : checked.errors;
    return { files: [], lines, code: 1 };
  }
  const { request, migration, model, notes } = checked;
  const { cwd } = project;
  const own = model === undefined ? [migration] : [migration, model];
  const schema = schemaWrites(cwd, request.db, checked.schema);
  const database = request.target.database.databaseName ?? request.target.database.binding;
  return {
    files: [...own, ...schema.files],
    lines: [
      ...own.map((file) => `Wrote ${shown(cwd, file.path)}`),
      ...schema.lines,
      ...notes.map((note) => `Note: ${note}`),
      `Next: npx wrangler d1 migrations apply ${database} --local`,
    ],
    code: 0,
  };
}

/**
 * `d1-record g model` and `g migration` (#66, #70): write a migration (and a Model), checked
 * against the existing migrations first, then regenerate the schema. Returns the exit code.
 */
export function runGenerate(options: GenerateOptions, print: Print): number {
  const cwd = resolve(options.cwd ?? process.cwd());
  const { config, models, out } = options;
  const model = options.kind === "model" ? modelName(options.name) : undefined;
  const files = model?.ok === true ? [modelPathOf(cwd, options, model.className)] : [];
  const project = readProject(cwd, { config, models, out }, files);
  if (typeof project === "string") {
    print(project);
    return 1;
  }
  return apply(planGenerate(project, options), print);
}
