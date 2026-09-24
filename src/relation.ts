import { hydrate, type ModelBase, type ModelClass } from "./model.ts";

/** A lazy, immutable description of a query against one Model. */
export class Relation<M extends ModelBase> {
  readonly #binding: D1Database;
  readonly #model: ModelClass<M>;

  constructor(binding: D1Database, model: ModelClass<M>) {
    this.#binding = binding;
    this.#model = model;
  }

  async toArray(): Promise<M[]> {
    const { results } = await this.#binding
      .prepare(`SELECT * FROM "${this.#model.tableName}"`)
      .all<Record<string, unknown>>();
    return results.map((row) => hydrate(this.#model, row));
  }
}
