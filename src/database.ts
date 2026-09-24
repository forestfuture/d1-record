import type { ModelBase, ModelClass } from "./model.ts";
import { Relation } from "./relation.ts";

/** A per-request wrapper around a D1 binding; every query goes through it. */
export class Database {
  readonly #binding: D1Database;

  constructor(binding: D1Database) {
    this.#binding = binding;
  }

  model<M extends ModelBase>(model: ModelClass<M>): Relation<M> {
    return new Relation(this.#binding, model);
  }
}

export function connect(binding: D1Database): Database {
  return new Database(binding);
}
