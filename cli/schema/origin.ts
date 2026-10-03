// Migrations written by another tool (Drizzle, Prisma) can store values differently from
// d1-record's conventions, so some columns convert to the wrong type without an error (#73).
// This recognises those tools and names the columns worth checking.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { underscore } from "../../src/naming.ts";
import type { GeneratedTable, Migration } from "./schema.ts";

type Tool = "Drizzle" | "Prisma";

/** Each tool's files in a project, and the marker it writes into its SQL. */
const signs: Record<Tool, { files: readonly string[]; marker: RegExp }> = {
  Drizzle: {
    files: ["drizzle.config.ts", "drizzle.config.js", "drizzle.config.mjs", "drizzle.config.json"],
    marker: /^--> statement-breakpoint/m,
  },
  Prisma: {
    files: ["prisma/schema.prisma", "schema.prisma", "prisma.config.ts"],
    marker: /^-- CreateTable$/m,
  },
};

const issue = "https://github.com/forestfuture/d1-record/issues/73";

/** Names that suggest a `TEXT` column holds JSON (`settings`, `payload_json`). */
const jsonish = /(^|_)(json|metadata|meta|settings|options|config|payload|properties|data)$/;

/**
 * The tool that wrote a project's migrations, if one is recognised: by its files in the project
 * (`drizzle.config.ts`, `prisma/schema.prisma`) or its marker in a migration.
 */
export function migrationTool(
  projectDir: string,
  migrations: readonly Migration[],
): Tool | undefined {
  const tools = Object.keys(signs) as Tool[];
  return tools.find(
    (tool) =>
      signs[tool].files.some((file) => existsSync(join(projectDir, file))) ||
      migrations.some((migration) => signs[tool].marker.test(migration.sql)),
  );
}

/** The columns worth checking, in a schema from `tool`'s migrations. */
function columnNotes(tool: Tool, tables: readonly GeneratedTable[]): string[] {
  const notes: string[] = [];
  for (const table of tables) {
    for (const [attribute, spec] of Object.entries(table.attributes)) {
      const column = spec.column ?? underscore(attribute);
      const where = `${table.name}.${column}`;
      if (spec.type === "integer" && column.endsWith("_at")) {
        notes.push(
          `${where}: read as an integer; if it holds a Unix timestamp, it's a number, not a Date`,
        );
      } else if (spec.type === "datetime" && tool === "Prisma") {
        notes.push(
          `${where}: read as a datetime (ISO text); if it holds a number, as Prisma may write, reads will fail`,
        );
      } else if (spec.type === "string" && jsonish.test(column)) {
        notes.push(
          `${where}: read as a string; if it holds JSON, override it as "json" in its Model`,
        );
      }
    }
  }
  return notes;
}

/** Notes for a schema generated from another tool's migrations: the tool, then the columns to check. */
export function originNotes(tool: Tool | undefined, tables: readonly GeneratedTable[]): string[] {
  if (tool === undefined) return [];
  return [
    `these migrations look like ${tool}'s. Some columns may convert to the wrong type without ` +
      `an error, especially numeric timestamps: check the generated types (${issue})`,
    ...columnNotes(tool, tables),
  ];
}
