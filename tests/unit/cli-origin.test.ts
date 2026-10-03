import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { migrationTool, originNotes } from "../../cli/schema/origin.ts";
import { schemaOf } from "../../cli/schema/schema.ts";

/** A throwaway project folder with these files. */
function projectWith(...files: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "d1-record-origin-"));
  for (const file of files) {
    mkdirSync(join(dir, file, ".."), { recursive: true });
    writeFileSync(join(dir, file), "");
  }
  return dir;
}

const plain = [{ name: "0001_init.sql", sql: "CREATE TABLE users (id TEXT PRIMARY KEY);" }];

describe("recognising another tool's migrations", () => {
  test("Drizzle, by its config file or the statement breakpoints it writes", () => {
    expect(migrationTool(projectWith("drizzle.config.ts"), plain)).toBe("Drizzle");
    expect(
      migrationTool(projectWith(), [
        {
          name: "0000_init.sql",
          sql: "CREATE TABLE a (id INTEGER PRIMARY KEY);\n--> statement-breakpoint\nCREATE TABLE b (id INTEGER PRIMARY KEY);",
        },
      ]),
    ).toBe("Drizzle");
  });

  test("Prisma, by its schema or config file, or the step comments it writes", () => {
    expect(migrationTool(projectWith("prisma/schema.prisma"), plain)).toBe("Prisma");
    expect(migrationTool(projectWith("prisma.config.ts"), plain)).toBe("Prisma");
    expect(
      migrationTool(projectWith(), [
        {
          name: "0001_init.sql",
          sql: '-- CreateTable\nCREATE TABLE "User" ("id" TEXT NOT NULL PRIMARY KEY);',
        },
      ]),
    ).toBe("Prisma");
  });

  test("Wrangler's own migrations aren't another tool's", () => {
    expect(migrationTool(projectWith("wrangler.jsonc"), plain)).toBeUndefined();
  });
});

describe("notes for another tool's migrations", () => {
  const result = schemaOf([
    {
      name: "0000_init.sql",
      sql: `CREATE TABLE posts (
        id INTEGER PRIMARY KEY,
        title TEXT,
        metadata TEXT,
        published_at INTEGER,
        created_at DATETIME
      );`,
    },
  ]);
  const tables = result.ok ? result.tables : [];

  test("the tool, then each column to check: numeric timestamps, and JSON in plain TEXT", () => {
    expect(originNotes("Drizzle", tables)).toEqual([
      "these migrations look like Drizzle's. Some columns may convert to the wrong type without an error, especially numeric timestamps: check the generated types (https://github.com/forestfuture/d1-record/issues/73)",
      'posts.metadata: read as a string; if it holds JSON, override it as "json" in its Model',
      "posts.published_at: read as an integer; if it holds a Unix timestamp, it's a number, not a Date",
    ]);
  });

  test("for Prisma, its DATETIME columns too, since it may store numbers in them", () => {
    expect(originNotes("Prisma", tables)).toContain(
      "posts.created_at: read as a datetime (ISO text); if it holds a number, as Prisma may write, reads will fail",
    );
  });

  test("none for Wrangler's own migrations", () => {
    expect(originNotes(undefined, tables)).toEqual([]);
  });
});
