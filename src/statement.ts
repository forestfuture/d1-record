import {
  compileInsert,
  compileInsertRows,
  type Assignment,
  type CompiledSql,
  type Conflict,
} from "./compiler.ts";
import type { Executor } from "./executor.ts";
import { attributeOf, evaluateDefaults, requireDefined } from "./metadata.ts";
import type { ModelClass } from "./model.ts";
import { timestampsFor } from "./timestamps.ts";

/** @internal The library's key for what `db.batch` needs from a Statement. */
export const statementParts = Symbol("statementParts");

/**
 * A write compiled in advance (`insert`, `updateAll`, `deleteAll`). It runs only through
 * `run()` or `db.batch([...])`, on the Database it was built from, and skips validations,
 * callbacks and hydration. It has no `then`, so it's never run by being awaited.
 */
export class Statement {
  readonly #executor: Executor;
  readonly #query: CompiledSql;

  /** @internal Statements are built by Relations: `insert`, `updateAll`, `deleteAll`. */
  constructor(executor: Executor, query: CompiledSql) {
    this.#executor = executor;
    this.#query = query;
  }

  /** Runs this statement on its own and resolves to D1's `meta` for it. */
  async run(): Promise<D1Meta> {
    return this.#executor.run(this.#query);
  }

  /** @internal The Database's Executor it runs on, and its compiled SQL. */
  get [statementParts](): { executor: Executor; query: CompiledSql } {
    return { executor: this.#executor, query: this.#query };
  }
}

/**
 * The attributes an insert statement writes: the given ones, then declared defaults for the
 * rest (where app-generated keys come from), then `createdAt`/`updatedAt` unless given.
 */
function insertAssignments(model: ModelClass, attributes: Record<string, unknown>): Assignment[] {
  for (const name of Object.keys(attributes)) attributeOf(model, name);
  const values = [...Object.entries(attributes), ...evaluateDefaults(model, attributes)];
  for (const [name, value] of values) requireDefined(model, name, value);
  return [...values, ...timestampsFor(model, "insert", values)];
}

/**
 * `INSERT` of `rows` into `model`'s table, as one Statement. Every row must have the same
 * attributes as given, as in Rails; `conflict` skips or updates rows that clash with a unique
 * index. An update sets only the given attributes (and `updatedAt`), never filled-in defaults.
 */
export function insertStatement(
  executor: Executor,
  model: ModelClass,
  rows: readonly Record<string, unknown>[],
  { conflict, method }: { conflict?: Conflict | undefined; method: string },
): Statement {
  const given = sameAttributes(rows, method);
  const assigned = rows.map((row) => new Map(insertAssignments(model, row)));
  const names = [...(assigned[0]?.keys() ?? [])];
  if (names.length === 0) {
    if (rows.length === 1 && conflict === undefined) {
      return new Statement(executor, compileInsert(model, []));
    }
    throw new TypeError(`${method}(): nothing to insert; give each row at least one attribute`);
  }
  const values = assigned.map((row) => names.map((name) => row.get(name)));
  const resolved =
    conflict?.kind === "update"
      ? { ...conflict, update: [...given, ...(names.includes("updatedAt") ? ["updatedAt"] : [])] }
      : conflict;
  return new Statement(executor, compileInsertRows(model, names, values, resolved));
}

/** The attributes every row was given; they must be the same for all rows, in any order. */
function sameAttributes(rows: readonly Record<string, unknown>[], method: string): string[] {
  const [first, ...rest] = rows.map((row) => Object.keys(row));
  if (first === undefined) throw new TypeError(`${method}() needs at least one row`);
  for (const [index, keys] of rest.entries()) {
    if (keys.length !== first.length || !first.every((name) => keys.includes(name))) {
      throw new TypeError(
        `${method}() rows must all have the same attributes: row ${index + 2} differs from the first (${first.join(", ")})`,
      );
    }
  }
  return first;
}
