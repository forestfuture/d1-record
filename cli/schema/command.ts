import {
  existsSync,
  globSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  watch,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fingerprintIn, fingerprintOf, renderSchema } from "./render.ts";
import { schemaOf, type Migration } from "./schema.ts";
import { readWranglerConfig, type DatabaseConfig } from "./wrangler.ts";

export interface SchemaOptions {
  /** The project's folder; the current one by default. */
  cwd?: string;
  /** Only report whether the generated files are current (for CI). */
  check?: boolean;
  /** The file to write (or, with several databases, the folder). */
  out?: string;
  /** The migrations folder, in place of the Wrangler config's. */
  migrations?: string;
  /** The Wrangler config file, in place of finding it. */
  config?: string;
}

type Print = (line: string) => void;

/** One database to generate: where its migrations are read from, and where its schema goes. */
interface Target {
  database: DatabaseConfig;
  configDir: string;
  migrationsDir: string;
  out: string;
}

/** A path as printed: relative to the project, with forward slashes. */
function shown(cwd: string, path: string): string {
  return relative(cwd, path).split(sep).join("/") || ".";
}

/** The databases to generate, from the Wrangler config and the options; or why there are none. */
function targetsOf(cwd: string, options: SchemaOptions): Target[] | string {
  const config = readWranglerConfig(cwd, options.config);
  if (!config.ok) return config.error;
  const { databases, dir } = config;
  if (options.migrations !== undefined && databases.length > 1) {
    return `--migrations needs a single database; this config has ${databases.length}`;
  }
  return databases.map((database) => {
    const migrationsDir = resolve(cwd, options.migrations ?? join(dir, database.migrationsDir));
    const out =
      databases.length === 1
        ? resolve(cwd, options.out ?? "src/db/schema.ts")
        : resolve(cwd, options.out ?? "src/db", `${database.binding}.ts`);
    return { database, configDir: dir, migrationsDir, out };
  });
}

/** A database's migrations, in the order Wrangler applies them: by file name. */
function migrationsOf(target: Target): Migration[] {
  const { migrationsPattern } = target.database;
  const files =
    migrationsPattern === undefined
      ? readdirSync(target.migrationsDir).filter((name) => name.endsWith(".sql"))
      : globSync(migrationsPattern, { cwd: target.configDir }).map((path) =>
          relative(target.migrationsDir, join(target.configDir, path)),
        );
  return files
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name, sql: readFileSync(join(target.migrationsDir, name), "utf8") }));
}

/** Reports a schema that couldn't be generated; the last good file stays as it was. */
function failed(errors: readonly string[], target: Target, out: string, print: Print): number {
  for (const error of errors) print(error);
  print(existsSync(target.out) ? `Kept ${out} as it was` : `Wrote nothing to ${out}`);
  return 1;
}

/** Whether the file on disk was generated from this schema (its fingerprint, not its format). */
function checked(
  existing: string | undefined,
  fingerprint: string,
  out: string,
  print: Print,
): number {
  const current = existing !== undefined && fingerprintIn(existing) === fingerprint;
  print(current ? `${out} is up to date` : `${out} is out of date: run \`d1-record schema\``);
  return current ? 0 : 1;
}

/** Writes a generated schema, making its folder if needed. */
function written(rendered: string, target: Target): void {
  mkdirSync(dirname(target.out), { recursive: true });
  writeFileSync(target.out, rendered);
}

/** Generates (or, with `check`, checks) one database's schema; 0 when it went well. */
function generate(cwd: string, target: Target, check: boolean, print: Print): number {
  const out = shown(cwd, target.out);
  const source = `${shown(cwd, target.migrationsDir)}/`;
  if (!existsSync(target.migrationsDir)) {
    return failed([`No migrations folder at ${source}`], target, out, print);
  }
  const result = schemaOf(migrationsOf(target), {
    migrationsTable: target.database.migrationsTable,
  });
  if (!result.ok) return failed(result.errors, target, out, print);
  const existing = existsSync(target.out) ? readFileSync(target.out, "utf8") : undefined;
  if (check) return checked(existing, fingerprintOf(result.tables), out, print);
  const rendered = renderSchema(result.tables, source);
  const count = `${result.tables.length} table${result.tables.length === 1 ? "" : "s"}`;
  if (rendered === existing) print(`${out} is up to date (${count})`);
  else {
    written(rendered, target);
    print(`Wrote ${out} (${count}) from ${source}`);
  }
  for (const note of result.notes) print(`Note: ${note}`);
  return 0;
}

/**
 * `d1-record schema`: generates each D1 database's `schema.ts` from its migrations (#66, #68).
 * Returns the exit code: 0, or 1 when anything failed or, with `check`, is out of date.
 */
export function runSchema(options: SchemaOptions, print: Print): number {
  const cwd = resolve(options.cwd ?? process.cwd());
  const targets = targetsOf(cwd, options);
  if (typeof targets === "string") {
    print(targets);
    return 1;
  }
  return Math.max(...targets.map((target) => generate(cwd, target, options.check === true, print)));
}

/**
 * `d1-record schema --watch`: generates, then again whenever a migration changes, keeping the
 * last good file when one fails. Returns a function that stops watching.
 */
export function watchSchema(options: SchemaOptions, print: Print): () => void {
  runSchema(options, print);
  const cwd = resolve(options.cwd ?? process.cwd());
  const targets = targetsOf(cwd, options);
  if (typeof targets === "string") return () => {};
  let pending: ReturnType<typeof setTimeout> | undefined;
  const regenerate = () => {
    clearTimeout(pending);
    pending = setTimeout(() => runSchema(options, print), 50);
  };
  const watchers = targets
    .filter((target) => existsSync(target.migrationsDir))
    .map((target) => watch(target.migrationsDir, { recursive: true }, regenerate));
  return () => {
    clearTimeout(pending);
    for (const watcher of watchers) watcher.close();
  };
}
