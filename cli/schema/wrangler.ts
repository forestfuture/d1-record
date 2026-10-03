import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/** One D1 database a Worker binds, and where its migrations are. */
export interface DatabaseConfig {
  binding: string;
  /** Relative to the config file. */
  migrationsDir: string;
  /** Cloudflare's `migrations_pattern`, a glob for nested layouts. */
  migrationsPattern?: string;
  migrationsTable?: string;
}

export type ConfigResult =
  | { ok: true; dir: string; databases: DatabaseConfig[] }
  | { ok: false; error: string };

const candidates = ["wrangler.jsonc", "wrangler.json", "wrangler.toml"];

/** JSON with comments and trailing commas, as wrangler.jsonc allows. */
function parseJsonc(text: string): unknown {
  let out = "";
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (char === '"') {
      const end = endOfString(text, index);
      out += text.slice(index, end);
      index = end - 1;
    } else if (text.startsWith("//", index)) {
      index = text.indexOf("\n", index) - 1;
      if (index < 0) break;
    } else if (text.startsWith("/*", index)) {
      index = text.indexOf("*/", index) + 1;
    } else out += char;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

/** Just past the string literal starting at `start`. */
function endOfString(text: string, start: number): number {
  let index = start + 1;
  while (index < text.length && text[index] !== '"') index += text[index] === "\\" ? 2 : 1;
  return index + 1;
}

/** The `[[d1_databases]]` entries of a wrangler.toml: only the keys this command reads. */
function parseToml(text: string): { d1_databases: Record<string, string>[] } {
  const databases: Record<string, string>[] = [];
  let current: Record<string, string> | undefined;
  for (const line of text.split("\n").map((each) => each.trim())) {
    if (line.startsWith("[")) {
      current = line === "[[d1_databases]]" ? {} : undefined;
      if (current !== undefined) databases.push(current);
      continue;
    }
    const pair = /^([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(line);
    if (current !== undefined && pair !== null) current[pair[1]!] = pair[2] ?? pair[3]!;
  }
  return { d1_databases: databases };
}

/** A config entry as a database: its binding, and its migrations' folder, pattern and table. */
function databaseOf(entry: Record<string, unknown>): DatabaseConfig {
  const database: DatabaseConfig = {
    binding: String(entry.binding),
    migrationsDir: typeof entry.migrations_dir === "string" ? entry.migrations_dir : "migrations",
  };
  if (typeof entry.migrations_pattern === "string")
    database.migrationsPattern = entry.migrations_pattern;
  if (typeof entry.migrations_table === "string") database.migrationsTable = entry.migrations_table;
  return database;
}

/**
 * The D1 databases in a project's Wrangler config: `wrangler.jsonc`, `wrangler.json` or
 * `wrangler.toml` in `cwd`, or the file `--config` names.
 */
export function readWranglerConfig(cwd: string, configPath?: string): ConfigResult {
  const file =
    configPath === undefined
      ? candidates.map((name) => join(cwd, name)).find((path) => existsSync(path))
      : resolve(cwd, configPath);
  if (file === undefined || !existsSync(file)) {
    return {
      ok: false,
      error: "No wrangler.jsonc, wrangler.json or wrangler.toml here (pass --config)",
    };
  }
  const text = readFileSync(file, "utf8");
  const config = (file.endsWith(".toml") ? parseToml(text) : parseJsonc(text)) as {
    d1_databases?: Record<string, unknown>[];
  };
  const entries = config.d1_databases ?? [];
  if (entries.length === 0) return { ok: false, error: `${basename(file)} has no d1_databases` };
  return { ok: true, dir: dirname(file), databases: entries.map(databaseOf) };
}
