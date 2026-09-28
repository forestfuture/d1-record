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

/** The library's key for what `db.batch` needs from a Statement; not exported. */
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

  /** The Database's Executor it runs on, and its compiled SQL. */
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
 * attributes, as in Rails; `conflict` skips or updates rows that clash with a unique index.
 */
export function insertStatement(
  executor: Executor,
  model: ModelClass,
  rows: readonly Record<string, unknown>[],
  conflict?: Conflict,
): Statement {
  const [first, ...rest] = rows.map((row) => new Map(insertAssignments(model, row)));
  if (first === undefined) throw new TypeError("insertAll() needs at least one row");
  const names = [...first.keys()];
  for (const [index, row] of rest.entries()) {
    if (row.size !== names.length || !names.every((name) => row.has(name))) {
      throw new TypeError(
        `insertAll() rows must all have the same attributes: row ${index + 2} differs from the first (${names.join(", ")})`,
      );
    }
  }
  if (names.length === 0 && rest.length === 0 && conflict === undefined) {
    return new Statement(executor, compileInsert(model, []));
  }
  const values = [first, ...rest].map((row) => names.map((name) => row.get(name)));
  return new Statement(executor, compileInsertRows(model, names, values, conflict));
}
