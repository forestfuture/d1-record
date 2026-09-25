import { Executor, type QueryListener } from "./executor.ts";
import { verifyModel, type ModelBase, type ModelClass } from "./model.ts";
import { Relation } from "./relation.ts";

/** One request-bound Relation per Model, keyed like the object passed to `db.models()`. */
export type RelationsFor<T extends Record<string, ModelClass<ModelBase>>> = {
  [K in keyof T]: Relation<InstanceType<T[K]>>;
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

  model<M extends ModelBase>(model: ModelClass<M>): Relation<M> {
    verifyModel(model);
    return new Relation(this.#executor, model);
  }

  /** Request-bound relations for several models at once: `db.models({ User }).User`. */
  models<const T extends Record<string, ModelClass<ModelBase>>>(models: T): RelationsFor<T> {
    return Object.fromEntries(
      Object.entries(models).map(([name, model]) => [name, this.model(model)]),
    ) as RelationsFor<T>;
  }
}

export function connect(binding: D1Database, options?: ConnectOptions): Database {
  return new Database(binding, options);
}
