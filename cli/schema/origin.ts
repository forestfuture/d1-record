// Recognizes migrations written by another tool (Drizzle, Prisma), and the columns to check.
// Those tools can store values differently from d1-record's conventions, so some columns
// convert to the wrong type and fail when they are read (#73, #159).
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { underscore } from "../../src/naming.ts";
import { storageOverride } from "./conventions.ts";
import { shown } from "../project/paths.ts";
import type { Target } from "../project/targets.ts";
import type { Migration } from "../project/migrations.ts";
import type { GeneratedTable } from "./schema.ts";

const tools = ["Drizzle", "Prisma"] as const;

export type Tool = (typeof tools)[number];

/** Each tool's files in a project, and the marker it writes into its SQL. */
const signs: Record<Tool, { files: readonly string[]; marker: RegExp }> = {
  Drizzle: {
    files: ["ts", "mts", "cts", "js", "mjs", "cjs", "json"].map((ext) => `drizzle.config.${ext}`),
    marker: /^--> statement-breakpoint/m,
  },
  Prisma: {
    files: ["prisma/schema.prisma", "schema.prisma", "prisma.config.ts"],
    marker: /^-- CreateTable$/m,
  },
};

const issue = "https://github.com/forestfuture/d1-record/issues/73";

/** Column names (as snake_case words) that suggest a `TEXT` column holds JSON. */
const jsonish = /(^|_)(json|metadata|settings|payload|properties)$/;

/**
 * The folders a tool's config may be in: the project's, and each above it up to the repository's
 * root (a monorepo keeps it there), or just the project's outside a repository.
 */
function searchedFolders(projectDir: string): string[] {
  const folders = [projectDir];
  for (let dir = projectDir; !existsSync(join(dir, ".git")); dir = dirname(dir)) {
    if (dirname(dir) === dir) return [projectDir];
    folders.push(dirname(dir));
  }
  return folders;
}

/** The tools whose files are in the project or above it (`drizzle.config.ts`, `prisma/schema.prisma`). */
export function toolsWithFiles(projectDir: string): Tool[] {
  const folders = searchedFolders(projectDir);
  return tools.filter((tool) =>
    folders.some((folder) => signs[tool].files.some((file) => existsSync(join(folder, file)))),
  );
}

/**
 * The tool that wrote a project's migrations, if one is recognised: by its files (`toolsFound`,
 * from `toolsWithFiles`), or its marker in a migration.
 */
export function migrationTool(
  toolsFound: readonly Tool[],
  migrations: readonly Migration[],
): Tool | undefined {
  return tools.find(
    (tool) =>
      toolsFound.includes(tool) ||
      migrations.some((migration) => signs[tool].marker.test(migration.sql)),
  );
}

/** Wrangler's hint for migrations in folders, when `hasNestedMigrations` found them. */
export function layoutNote(cwd: string, target: Target): string {
  const dir = target.migrationsDir;
  const pattern = `${shown(target.configDir, dir)}/*/migration.sql`;
  return (
    `${shown(cwd, dir)}/ has its migrations in folders, as Drizzle writes them; set ` +
    `migrations_pattern to "${pattern}" in your Wrangler config, so Wrangler and d1-record read them`
  );
}

/** The columns worth checking, in a schema from `tool`'s migrations. */
function columnNotes(tool: Tool, tables: readonly GeneratedTable[]): string[] {
  const notes: string[] = [];
  for (const table of tables) {
    for (const [attribute, spec] of Object.entries(table.attributes)) {
      const column = spec.column ?? underscore(attribute);
      // Drizzle names columns after their TypeScript keys by default (createdAt), so compare words.
      const words = underscore(column);
      const where = `${table.name}.${column}`;
      if (spec.type === "integer" && words.endsWith("_at")) {
        notes.push(
          `${where}: read as an integer; if it holds a Unix timestamp, override it in its Model as ` +
            storageOverride(tool === "Drizzle"),
        );
      } else if (spec.type === "string" && jsonish.test(words)) {
        notes.push(
          `${where}: read as a string; if it holds JSON, override it as "json" in its Model`,
        );
      }
    }
  }
  return notes;
}

/** A note for a datetime whose default writes SQLite's date text, which sorts apart from ISO (#143). */
function textDateNote(where: string): string {
  return (
    `${where}: its default writes SQLite's date text (2026-10-12 06:38:30), where d1-record ` +
    `writes ISO text (2026-10-12T06:38:30.000Z), and the two sort apart as text, so range ` +
    `conditions can misplace values within a day (see Existing databases in the guide)`
  );
}

/**
 * Notes for a schema generated from another tool's migrations: the tool, then the columns to
 * check, and `textDates`, the datetime columns whose default is SQLite's own date text.
 */
export function originNotes(
  tool: Tool | undefined,
  tables: readonly GeneratedTable[],
  textDates: readonly string[],
): string[] {
  if (tool === undefined) return [];
  return [
    `these migrations look like ${tool}'s. Some columns may convert to the wrong type and fail ` +
      `when read, especially numeric timestamps: check the generated types (${issue})`,
    ...columnNotes(tool, tables),
    ...textDates.map(textDateNote),
  ];
}
