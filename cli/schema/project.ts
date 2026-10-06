// A project's D1 databases, from its Wrangler config: where each one's migrations are, and
// where its generated schema goes. Shared by \`d1-record schema\` and the generators.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { classify, moduleName } from "./names.ts";
import { byName, type Migration } from "./schema.ts";
import { readWranglerConfig, type DatabaseConfig } from "./wrangler.ts";

/** Where a project's config, migrations and generated schema are, when not the defaults. */
export interface ProjectOptions {
  /** The Wrangler config file, in place of finding it. */
  config?: string;
  /** The migrations folder, in place of the Wrangler config's. */
  migrations?: string;
  /** The file to write (or, with several databases, the folder). */
  out?: string;
  /** Where Models and their base class live (`src/models`), or one file of Models (`src/models.ts`). */
  models?: string;
}

export type Print = (line: string) => void;

/** One database to generate: where its migrations are read from, and where its schema goes. */
export interface Target {
  database: DatabaseConfig;
  configDir: string;
  migrationsDir: string;
  out: string;
  /** The app's base class for this database's Models: its file, and its name. */
  base: { path: string; className: string };
}

/**
 * A database's base class: `ApplicationRecord` when there's one database, as in Rails, and one
 * per binding when there are several (`LOGS` → `LogsRecord`), as Rails names them.
 */
function baseFor(modelsDir: string, binding: string, several: boolean): Target["base"] {
  if (!several) {
    return { path: join(modelsDir, "application-record.ts"), className: "ApplicationRecord" };
  }
  // Bindings are JavaScript names (env.MY_DB), so their words are split by `_`.
  const className = `${classify(binding.toLowerCase())}Record`;
  return { path: join(modelsDir, `${moduleName(className)}.ts`), className };
}

/** Where Models and their base class go without `--models`. */
export const defaultModels = "src/models";

/** Whether `--models` names one file all Models go in (`src/models.ts`), not a folder. */
export function oneModelsFile(models: string): boolean {
  return models.endsWith(".ts");
}

/** The folder Models and their base class live in: `--models`, or `src/models`. */
function modelsDirOf(cwd: string, models = defaultModels): string {
  const path = resolve(cwd, models);
  return oneModelsFile(models) ? dirname(path) : path;
}

/** Bindings whose base classes would be the same (`DB` and `db` → `DbRecord`), as an error. */
function sharedBase(targets: readonly Target[]): string | undefined {
  const seen = new Map<string, string>();
  for (const { database, base } of targets) {
    const other = seen.get(base.className);
    if (other !== undefined) {
      return `The bindings ${other} and ${database.binding} would share the base class ${base.className}; rename one`;
    }
    seen.set(base.className, database.binding);
  }
  return undefined;
}

/** A relative path with forward slashes, as Wrangler names migrations on every system. */
export function slashed(path: string): string {
  return path.split(sep).join("/");
}

/** A module path from one file's folder to another file, as an import writes it (`../db/schema`). */
export function importPath(fromDir: string, to: string): string {
  const path = slashed(relative(fromDir, to)).replace(/\.ts$/, "");
  return path.startsWith(".") ? path : `./${path}`;
}

/** A path as printed: relative to the project, with forward slashes. */
export function shown(cwd: string, path: string): string {
  return slashed(relative(cwd, path)) || ".";
}

/** The databases to generate, from the Wrangler config and the options; or why there are none. */
export function targetsOf(cwd: string, options: ProjectOptions): Target[] | string {
  const config = readWranglerConfig(cwd, options.config);
  if (!config.ok) return config.error;
  const { databases, dir } = config;
  if (options.migrations !== undefined && databases.length > 1) {
    return `--migrations needs a single database; this config has ${databases.length}`;
  }
  const targets = databases.map((database) => {
    const migrationsDir = resolve(cwd, options.migrations ?? join(dir, database.migrationsDir));
    const out =
      databases.length === 1
        ? resolve(cwd, options.out ?? "src/db/schema.ts")
        : resolve(cwd, options.out ?? "src/db", `${database.binding}.ts`);
    const base = baseFor(modelsDirOf(cwd, options.models), database.binding, databases.length > 1);
    return { database, configDir: dir, migrationsDir, out, base };
  });
  return sharedBase(targets) ?? targets;
}

/** A database's migrations, in the order Wrangler applies them: by file name. */
export function migrationsOf(target: Target): Migration[] {
  const { migrationsPattern } = target.database;
  const files =
    migrationsPattern === undefined
      ? readdirSync(target.migrationsDir).filter((name) => name.endsWith(".sql"))
      : // Loaded when used (Node 22+), so an older Node gets the command's own message (cli/main.ts).
        process
          .getBuiltinModule("node:fs")
          .globSync(migrationsPattern, { cwd: target.configDir })
          .map((path) => slashed(relative(target.migrationsDir, join(target.configDir, path))));
  return files
    .sort(byName)
    .map((name) => ({ name, sql: readFileSync(join(target.migrationsDir, name), "utf8") }));
}
