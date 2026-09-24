import { compileSelect } from "./compiler.ts";
import type { Executor } from "./executor.ts";
import { hydrate, type ModelBase, type ModelClass } from "./model.ts";

/** A lazy, immutable description of a query against one Model. */
export class Relation<M extends ModelBase> {
  readonly #executor: Executor;
  readonly #model: ModelClass<M>;
  readonly #conditions: readonly Record<string, unknown>[];

  constructor(
    executor: Executor,
    model: ModelClass<M>,
    conditions: readonly Record<string, unknown>[] = [],
  ) {
    this.#executor = executor;
    this.#model = model;
    this.#conditions = conditions;
  }

  where(conditions: Record<string, unknown>): Relation<M> {
    return new Relation(this.#executor, this.#model, [...this.#conditions, conditions]);
  }

  async toArray(): Promise<M[]> {
    const { sql, params } = compileSelect({ model: this.#model, conditions: this.#conditions });
    const rows = await this.#executor.all(sql, params);
    return rows.map((row) => hydrate(this.#model, row));
  }
}
