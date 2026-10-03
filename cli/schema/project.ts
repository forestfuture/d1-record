// A project's D1 databases, from its Wrangler config: where each one's migrations are, and
// where its generated schema goes. Shared by \`d1-record schema\` and the generators.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type { SchemaOptions } from "./command.ts";
import { byName, type Migration } from "./schema.ts";
import { readWranglerConfig, type DatabaseConfig } from "./wrangler.ts";

export type Print = (line: string) => void;

/** One database to generate: where its migrations are read from, and where its schema goes. */
export interface Target {
  database: DatabaseConfig;
  configDir: string;
  migrationsDir: string;
  out: string;
}

/** A path as printed: relative to the project, with forward slashes. */
export function shown(cwd: string, path: string): string {
  return relative(cwd, path).split(sep).join("/") || ".";
}

/** The databases to generate, from the Wrangler config and the options; or why there are none. */
export function targetsOf(
  cwd: string,
  options: Pick<SchemaOptions, "config" | "migrations" | "out">,
): Target[] | string {
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
export function migrationsOf(target: Target): Migration[] {
  const { migrationsPattern } = target.database;
  const files =
    migrationsPattern === undefined
      ? readdirSync(target.migrationsDir).filter((name) => name.endsWith(".sql"))
      : // Loaded when used (Node 22+), so an older Node gets the command's own message (cli/main.ts).
        process
          .getBuiltinModule("node:fs")
          .globSync(migrationsPattern, { cwd: target.configDir })
          .map((path) => relative(target.migrationsDir, join(target.configDir, path)));
  return files
    .sort(byName)
    .map((name) => ({ name, sql: readFileSync(join(target.migrationsDir, name), "utf8") }));
}
