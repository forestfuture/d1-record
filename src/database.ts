import { Executor, type QueryListener } from "./executor.ts";
import type { ModelBase, ModelClass } from "./model.ts";
import { Relation } from "./relation.ts";

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
    return new Relation(this.#executor, model);
  }
}

export function connect(binding: D1Database, options?: ConnectOptions): Database {
  return new Database(binding, options);
}
