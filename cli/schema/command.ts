import { existsSync, mkdirSync, readFileSync, watch, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  migrationsOf,
  shown,
  targetsOf,
  type Print,
  type ProjectOptions,
  type Target,
} from "./project.ts";
import { fingerprintIn, fingerprintOf, renderSchema } from "./render.ts";
import { schemaOf } from "./schema.ts";

export interface SchemaOptions extends ProjectOptions {
  /** The project's folder; the current one by default. */
  cwd?: string;
  /** Only report whether the generated files are current (for CI). */
  check?: boolean;
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
export function generateSchema(cwd: string, target: Target, check: boolean, print: Print): number {
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
  return Math.max(
    ...targets.map((target) => generateSchema(cwd, target, options.check === true, print)),
  );
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
