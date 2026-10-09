import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vite-plus/test";
import { databaseFor } from "../../cli/console/database.ts";

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A project folder with a Wrangler config binding these D1 databases. */
function project(...bindings: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "console-db-"));
  made.push(dir);
  const d1_databases = bindings.map((binding) => ({ binding, database_name: `${binding}-name` }));
  writeFileSync(join(dir, "wrangler.jsonc"), JSON.stringify({ d1_databases }));
  return dir;
}

describe("the database the console opens", () => {
  test("the only one, with the config file Wrangler should read", () => {
    const cwd = project("DB");

    expect(databaseFor(cwd, {})).toEqual({
      binding: "DB",
      entry: { binding: "DB", database_name: "DB-name" },
      configFile: join(cwd, "wrangler.jsonc"),
    });
  });

  test("with several, the one --database names", () => {
    const cwd = project("DB", "LOGS");

    expect(databaseFor(cwd, { database: "LOGS" })).toMatchObject({ binding: "LOGS" });
  });

  test("with several and no --database, it lists them", () => {
    expect(databaseFor(project("DB", "LOGS"), {})).toBe(
      "This config has several D1 databases; choose one with --database (DB or LOGS)",
    );
  });

  test("a --database the config doesn't bind says which it has", () => {
    expect(databaseFor(project("DB", "LOGS"), { database: "CACHE" })).toBe(
      "No D1 database is bound as CACHE; this config has DB or LOGS",
    );
  });

  test("no config says so", () => {
    const cwd = mkdtempSync(join(tmpdir(), "console-db-"));
    made.push(cwd);

    expect(databaseFor(cwd, {})).toBe(
      "No wrangler.jsonc, wrangler.json or wrangler.toml here (pass --config)",
    );
  });
});
