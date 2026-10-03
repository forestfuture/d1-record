import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { runSchema, watchSchema } from "../../cli/schema/command.ts";

/** A throwaway project: its files, by path. */
function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "d1-record-schema-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

/** Runs the command, collecting what it prints. */
function run(cwd: string, options: Parameters<typeof runSchema>[0] = {}) {
  const output: string[] = [];
  const code = runSchema({ cwd, ...options }, (line) => output.push(line));
  return { code, output: output.join("\n") };
}

const wranglerJsonc = `{
  // A comment, as wrangler.jsonc allows.
  "name": "app",
  "d1_databases": [{ "binding": "DB", "database_name": "app-db", "database_id": "x" }],
}`;

describe("d1-record schema", () => {
  test("writes src/db/schema.ts from the Wrangler config's migrations", () => {
    const cwd = project({
      "wrangler.jsonc": wranglerJsonc,
      "migrations/0001_create_users.sql":
        "CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL);",
      "migrations/0002_add_bio.sql": "ALTER TABLE users ADD COLUMN bio TEXT;",
    });

    const { code, output } = run(cwd);

    const schema = readFileSync(join(cwd, "src/db/schema.ts"), "utf8");
    expect(code).toBe(0);
    expect(output).toBe("Wrote src/db/schema.ts (1 table) from migrations/");
    expect(schema).toContain("/** users — last changed by 0002_add_bio.sql */");
    expect(schema).toContain('  bio: "string",');
  });

  test("reads wrangler.toml, and a database's own migrations_dir and migrations_table", () => {
    const cwd = project({
      "wrangler.toml": `name = "app"

[[d1_databases]]
binding = "DB"
database_name = "app-db"
database_id = "x"
migrations_dir = "db/migrate"
migrations_table = "seen"
`,
      "db/migrate/0001_create.sql":
        "CREATE TABLE seen (id INTEGER PRIMARY KEY); CREATE TABLE posts (id INTEGER PRIMARY KEY);",
    });

    expect(run(cwd).code).toBe(0);
    const schema = readFileSync(join(cwd, "src/db/schema.ts"), "utf8");
    expect(schema).toContain("from db/migrate/");
    expect(schema).toContain("export const posts");
    expect(schema).not.toContain("export const seen");
  });

  test("writes one file per database when there are several", () => {
    const cwd = project({
      "wrangler.json": JSON.stringify({
        d1_databases: [
          { binding: "DB", database_name: "app" },
          { binding: "ANALYTICS", database_name: "stats", migrations_dir: "analytics-migrations" },
        ],
      }),
      "migrations/0001.sql": "CREATE TABLE users (id INTEGER PRIMARY KEY);",
      "analytics-migrations/0001.sql": "CREATE TABLE events (id INTEGER PRIMARY KEY);",
    });

    expect(run(cwd).code).toBe(0);
    expect(readFileSync(join(cwd, "src/db/DB.ts"), "utf8")).toContain("export const users");
    expect(readFileSync(join(cwd, "src/db/ANALYTICS.ts"), "utf8")).toContain("export const events");
    expect(existsSync(join(cwd, "src/db/schema.ts"))).toBe(false);
  });

  test("--out and --migrations choose other places", () => {
    const cwd = project({
      "wrangler.jsonc": wranglerJsonc,
      "sql/0001.sql": "CREATE TABLE users (id INTEGER PRIMARY KEY);",
    });

    expect(run(cwd, { out: "app/schema.ts", migrations: "sql" }).code).toBe(0);
    expect(readFileSync(join(cwd, "app/schema.ts"), "utf8")).toContain("export const users");
  });

  test("--check passes when current, ignores formatting, and fails when a migration changed it", () => {
    const cwd = project({
      "wrangler.jsonc": wranglerJsonc,
      "migrations/0001.sql": "CREATE TABLE users (id INTEGER PRIMARY KEY);",
    });
    run(cwd);
    const path = join(cwd, "src/db/schema.ts");
    writeFileSync(path, readFileSync(path, "utf8").replaceAll("  ", "    ").replaceAll('"', "'"));

    const current = run(cwd, { check: true });
    writeFileSync(join(cwd, "migrations/0002.sql"), "ALTER TABLE users ADD COLUMN name TEXT;");
    const stale = run(cwd, { check: true });

    expect(current).toEqual({ code: 0, output: "src/db/schema.ts is up to date" });
    expect(stale.code).toBe(1);
    expect(stale.output).toBe("src/db/schema.ts is out of date: run `d1-record schema`");
  });

  test("a broken migration is reported, and the last good schema.ts is kept", () => {
    const cwd = project({
      "wrangler.jsonc": wranglerJsonc,
      "migrations/0001.sql": "CREATE TABLE users (id INTEGER PRIMARY KEY);",
    });
    run(cwd);
    const before = readFileSync(join(cwd, "src/db/schema.ts"), "utf8");
    writeFileSync(join(cwd, "migrations/0002.sql"), "ALTER TABLE user ADD COLUMN x TEXT;");

    const { code, output } = run(cwd);

    expect(code).toBe(1);
    expect(output).toMatch(
      /^0002\.sql: .*no such table: user\nKept src\/db\/schema\.ts as it was$/,
    );
    expect(readFileSync(join(cwd, "src/db/schema.ts"), "utf8")).toBe(before);
  });

  test("no Wrangler config, or no D1 database in it, says so", () => {
    expect(run(project({ "readme.md": "" }))).toEqual({
      code: 1,
      output: "No wrangler.jsonc, wrangler.json or wrangler.toml here (pass --config)",
    });
    expect(run(project({ "wrangler.jsonc": "{}" }))).toEqual({
      code: 1,
      output: "wrangler.jsonc has no d1_databases",
    });
  });

  test("a Wrangler config it can't use says why", () => {
    expect(run(project({ "wrangler.jsonc": '{ /* never closed "d1_databases": [] }' }))).toEqual({
      code: 1,
      output: "wrangler.jsonc couldn't be read: Unterminated /* comment",
    });
    expect(
      run(project({ "wrangler.jsonc": '{ "d1_databases": [{ "database_name": "x" }] }' })),
    ).toEqual({
      code: 1,
      output: "wrangler.jsonc has a d1_databases entry with no binding",
    });
  });

  test("reads wrangler.toml's spaced and commented headers, and its escaped strings", () => {
    const cwd = project({
      "wrangler.toml": `[[ d1_databases ]] # the app's database
binding = "DB"
migrations_dir = "db\\u002Fmigrate"
`,
      "db/migrate/0001.sql": "CREATE TABLE users (id INTEGER PRIMARY KEY);",
    });

    expect(run(cwd)).toMatchObject({ code: 0, output: expect.stringMatching(/^Wrote/) });
  });

  test("reads nested migrations through the config's migrations_pattern", () => {
    const cwd = project({
      "wrangler.jsonc": `{ "d1_databases": [{ "binding": "DB", "migrations_pattern": "migrations/*/migration.sql" }] }`,
      "migrations/0001_init/migration.sql": "CREATE TABLE users (id INTEGER PRIMARY KEY);",
      "migrations/0002_bio/migration.sql": "ALTER TABLE users ADD COLUMN bio TEXT;",
      "migrations/0002_bio/notes.md": "Not a migration.",
    });

    const { code } = run(cwd);

    const schema = readFileSync(join(cwd, "src/db/schema.ts"), "utf8");
    expect(code).toBe(0);
    expect(schema).toContain("/** users — last changed by 0002_bio/migration.sql */");
  });

  test("migrations from Drizzle get notes on the columns worth checking", () => {
    const cwd = project({
      "wrangler.jsonc": `{ "d1_databases": [{ "binding": "DB", "migrations_dir": "drizzle" }] }`,
      "drizzle.config.ts": "export default {};",
      "drizzle/0000_init.sql":
        "CREATE TABLE posts (id INTEGER PRIMARY KEY, published_at INTEGER);\n--> statement-breakpoint\nCREATE INDEX i ON posts (published_at);",
    });

    const { code, output } = run(cwd);

    expect(code).toBe(0);
    expect(output.split("\n").slice(1)).toEqual([
      expect.stringMatching(
        /^Note: these migrations look like Drizzle's\. Some columns may convert/,
      ),
      "Note: posts.published_at: read as an integer; if it holds a Unix timestamp, it's a number, not a Date",
    ]);
  });

  test("notes come with a file that's written, not again when it's up to date, or with --check", () => {
    const cwd = project({
      "wrangler.jsonc": wranglerJsonc,
      "drizzle.config.ts": "export default {};",
      "migrations/0000_init.sql":
        "CREATE TABLE posts (id INTEGER PRIMARY KEY, published_at INTEGER);",
    });

    const first = run(cwd);
    const again = run(cwd);
    const checked = run(cwd, { check: true });

    expect(first.output).toContain("Note: posts.published_at");
    expect(again.output).toBe("src/db/schema.ts is up to date (1 table)");
    expect(checked.output).toBe("src/db/schema.ts is up to date");
  });

  test("migrations in folders, as Drizzle writes them, get Wrangler's hint to set migrations_pattern", () => {
    const cwd = project({
      "wrangler.jsonc": wranglerJsonc,
      "migrations/0000_init/migration.sql": "CREATE TABLE posts (id INTEGER PRIMARY KEY);",
    });

    expect(run(cwd).output).toBe(`Wrote src/db/schema.ts (0 tables) from migrations/
Note: migrations/ has its migrations in folders, as Drizzle writes them; set migrations_pattern to "migrations/*/migration.sql" in your Wrangler config, so Wrangler and d1-record read them`);
  });

  test("--watch regenerates when a migration changes", async () => {
    const cwd = project({
      "wrangler.jsonc": wranglerJsonc,
      "migrations/0001.sql": "CREATE TABLE users (id INTEGER PRIMARY KEY);",
    });
    const stop = watchSchema({ cwd }, () => {});
    // Let the file watcher settle first, as it has by the time anyone edits a migration.
    await new Promise((resolve) => setTimeout(resolve, 250));
    writeFileSync(join(cwd, "migrations/0002.sql"), "ALTER TABLE users ADD COLUMN name TEXT;");

    await expect
      .poll(() => readFileSync(join(cwd, "src/db/schema.ts"), "utf8"), { timeout: 5000 })
      .toContain('  name: "string",');
    stop();
  });

  test("--watch carries on after a broken migration, and regenerates once it's fixed", async () => {
    const cwd = project({
      "wrangler.jsonc": wranglerJsonc,
      "migrations/0001.sql": "CREATE TABLE users (id INTEGER PRIMARY KEY);",
    });
    const output: string[] = [];
    const stop = watchSchema({ cwd }, (line) => output.push(line));
    await new Promise((resolve) => setTimeout(resolve, 250));
    writeFileSync(join(cwd, "migrations/0002.sql"), "ALTER TABLE user ADD COLUMN name TEXT;");
    await expect.poll(() => output.join("\n"), { timeout: 5000 }).toContain("no such table: user");

    writeFileSync(join(cwd, "migrations/0002.sql"), "ALTER TABLE users ADD COLUMN name TEXT;");

    await expect
      .poll(() => readFileSync(join(cwd, "src/db/schema.ts"), "utf8"), { timeout: 5000 })
      .toContain('  name: "string",');
    stop();
  });
});
