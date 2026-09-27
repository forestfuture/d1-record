import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import type { TestDatabase as D1Database } from "../support/d1.ts";

/**
 * The remote smoke suite runs against a real D1 database, through Wrangler's remote bindings.
 * It needs three environment variables (see docs/agents/remote-smoke.md):
 * `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` and `D1_SMOKE_DATABASE_ID`.
 * Without them the suite is skipped.
 */
export const configured =
  process.env["CLOUDFLARE_ACCOUNT_ID"] !== undefined &&
  process.env["CLOUDFLARE_API_TOKEN"] !== undefined &&
  process.env["D1_SMOKE_DATABASE_ID"] !== undefined;

/** Every run's tables start with this, then the run's start time (base 36). */
const PREFIX = "smoke_";

/** Tables of runs that crashed before cleaning up are dropped after this long. */
const STALE_AFTER_MS = 60 * 60 * 1000;

/** The fixture tables, created with the run's prefix: `{p}users`, `{p}posts`, … */
function schema(p: string): string[] {
  return [
    `CREATE TABLE ${p}users (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      role TEXT,
      settings TEXT,
      created_at TEXT,
      updated_at TEXT
    )`,
    `CREATE TABLE ${p}posts (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES ${p}users (id),
      title TEXT NOT NULL,
      published INTEGER NOT NULL DEFAULT 0,
      views INTEGER NOT NULL DEFAULT 0 CHECK (views >= 0)
    )`,
  ];
}

export interface RemoteDatabase {
  binding: D1Database;
  /** This run's table prefix, e.g. `smoke_lx3k9a_4f2c_`. */
  prefix: string;
  dispose: () => Promise<void>;
}

/**
 * Connects to the remote smoke database, drops tables left by stale runs, and creates this
 * run's tables. `dispose()` drops them again and closes the proxy.
 */
export async function remoteDatabase(): Promise<RemoteDatabase> {
  const directory = mkdtempSync(join(tmpdir(), "d1-record-smoke-"));
  const configPath = join(directory, "wrangler.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      name: "d1-record-smoke",
      compatibility_date: "2026-09-01",
      d1_databases: [
        {
          binding: "DB",
          database_name: "d1-record-smoke",
          database_id: process.env["D1_SMOKE_DATABASE_ID"],
          remote: true,
        },
      ],
    }),
  );
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath, persist: false });
  const binding = proxy.env.DB;
  await dropStaleTables(binding);
  const prefix = `${PREFIX}${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}_`;
  await binding.batch(schema(prefix).map((statement) => binding.prepare(statement)));
  return {
    binding,
    prefix,
    async dispose() {
      try {
        await dropTables(binding, (name) => name.startsWith(prefix));
      } finally {
        await proxy.dispose();
        rmSync(directory, { recursive: true, force: true });
      }
    },
  };
}

async function dropStaleTables(binding: D1Database): Promise<void> {
  const cutoff = Date.now() - STALE_AFTER_MS;
  await dropTables(binding, (name) => {
    const started = Number.parseInt(name.slice(PREFIX.length).split("_")[0] ?? "", 36);
    return Number.isFinite(started) && started < cutoff;
  });
}

/** Drops the smoke tables matching `select`: posts before users, for the foreign key. */
async function dropTables(binding: D1Database, select: (name: string) => boolean): Promise<void> {
  const { results } = await binding
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE ?")
    .bind(`${PREFIX}%`)
    .all<{ name: string }>();
  const names = results
    .map(({ name }) => name)
    .filter(select)
    .sort((a, b) => Number(b.endsWith("posts")) - Number(a.endsWith("posts")));
  if (names.length === 0) return;
  await binding.batch(names.map((name) => binding.prepare(`DROP TABLE IF EXISTS "${name}"`)));
}
