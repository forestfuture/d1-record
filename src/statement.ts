import { compileInsert, type Assignment, type CompiledQuery } from "./compiler.ts";
import type { Executor } from "./executor.ts";
import { attributeOf } from "./metadata.ts";
import type { ModelClass } from "./model.ts";
import { timestampsFor } from "./timestamps.ts";

/**
 * A write compiled in advance (`insert`, `updateAll`, `deleteAll`). It runs only through
 * `run()` or `db.batch([...])`, on the Database it was built from, and skips validations,
 * callbacks and hydration. It has no `then`, so it's never run by being awaited.
 */
export class Statement {
  readonly #executor: Executor;
  readonly #query: CompiledQuery;

  /** @internal Statements are built by Relations: `insert`, `updateAll`, `deleteAll`. */
  constructor(executor: Executor, query: CompiledQuery) {
    this.#executor = executor;
    this.#query = query;
  }

  /** Runs this statement on its own and resolves to D1's `meta` for it. */
  async run(): Promise<D1Meta> {
    return this.#executor.run(this.#query);
  }
}

/**
 * The attributes an insert statement writes: the given ones, then declared defaults for the
 * rest (where app-generated keys come from), then `createdAt`/`updatedAt` unless given.
 */
function insertAssignments(model: ModelClass, attributes: Record<string, unknown>): Assignment[] {
  for (const name of Object.keys(attributes)) attributeOf(model, name);
  const defaults = [...model.attributeDefinitions]
    .filter(([name, definition]) => definition.default !== undefined && !(name in attributes))
    .map(([name, definition]): Assignment => [name, definition.default!()]);
  const values = [...Object.entries(attributes), ...defaults];
  for (const [name, value] of values) {
    // As with assignment: undefined would silently store NULL.
    if (value === undefined) {
      throw new TypeError(`${model.name}: got undefined for "${name}"; use null to store NULL`);
    }
  }
  return [...values, ...timestampsFor(model, true, values)];
}

/** `INSERT` of `attributes` into `model`'s table, as a Statement. */
export function insertStatement(
  executor: Executor,
  model: ModelClass,
  attributes: Record<string, unknown>,
): Statement {
  return new Statement(executor, compileInsert(model, insertAssignments(model, attributes)));
}
