import { IncompatibleRelation } from "./errors.ts";
import { Executor, type QueryListener } from "./executor.ts";
import { prepareModel } from "./associations.ts";
import type { ModelBase, ModelClass, ScopesOf } from "./model.ts";
import type { Scoped } from "./relation.ts";
import { relationFor } from "./scoped-relation.ts";
import { statementParts, type Statement } from "./statement.ts";

/** One request-bound Relation per Model, keyed like the object passed to `db.models()`. */
export type RelationsFor<T extends Record<string, ModelClass<ModelBase>>> = {
  [K in keyof T]: Scoped<InstanceType<T[K]>, ScopesOf<T[K]>>;
};

export interface ConnectOptions {
  /** Called once for every statement sent to D1. */
  onQuery?: QueryListener;
}

/** A per-request wrapper around a D1 binding; every query goes through it. */
export class Database {
  readonly #executor: Executor;

  constructor(binding: D1Database, options: ConnectOptions = {}) {
    this.#executor = new Executor(binding, options.onQuery);
  }

  /** A request-bound Relation over the Model's records, with its scopes as methods. */
  model<C extends ModelClass<ModelBase>>(model: C): Scoped<InstanceType<C>, ScopesOf<C>> {
    prepareModel(model);
    return relationFor(this.#executor, model);
  }

  /** Request-bound relations for several models at once: `db.models({ User }).User`. */
  models<const T extends Record<string, ModelClass<ModelBase>>>(models: T): RelationsFor<T> {
    // Each entry is exactly db.model(thatModel), so it has that Model's Relation type.
    return Object.fromEntries(
      Object.entries(models).map(([name, model]) => [name, this.model(model)]),
    ) as unknown as RelationsFor<T>;
  }

  /**
   * Runs statements from `insert`, `updateAll` and `deleteAll` atomically, with D1's `batch()`:
   * all of them are written, or none. Resolves to D1's `meta` for each, in order. There's no
   * interactive `transaction()`, because D1 can't hold one open across awaits.
   */
  async batch(statements: readonly Statement[]): Promise<D1Meta[]> {
    const queries = statements.map((statement) => {
      const { executor, query } = statement[statementParts];
      if (executor !== this.#executor) {
        throw new IncompatibleRelation(
          "batch() needs statements built on this Database; one comes from another connect() call",
        );
      }
      return query;
    });
    return this.#executor.batch(queries);
  }
}

export function connect(binding: D1Database, options?: ConnectOptions): Database {
  return new Database(binding, options);
}
