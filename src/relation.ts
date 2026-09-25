import { compileSelect, type Condition } from "./compiler.ts";
import type { Executor } from "./executor.ts";
import {
  attributeOf,
  hydrate,
  type AttributesOf,
  type ModelBase,
  type ModelClass,
} from "./model.ts";
import { ColumnReference, SafeSql } from "./sql.ts";

/** A lazy, immutable description of a query against one Model. */
export class Relation<M extends ModelBase> {
  readonly #executor: Executor;
  readonly #model: ModelClass<M>;
  readonly #conditions: readonly Condition[];

  constructor(executor: Executor, model: ModelClass<M>, conditions: readonly Condition[] = []) {
    this.#executor = executor;
    this.#model = model;
    this.#conditions = conditions;
  }

  where(conditions: Partial<AttributesOf<M>> | SafeSql): Relation<M> {
    if (typeof conditions !== "object" || conditions === null || Array.isArray(conditions)) {
      throw new TypeError(
        "where() takes an object of attribute values or an sql`…` fragment; plain strings are not accepted",
      );
    }
    // Check attribute names now, so a typo fails where it was written rather than at toArray().
    const names =
      conditions instanceof SafeSql
        ? conditions.values.flatMap((value) =>
            value instanceof ColumnReference ? [value.attribute] : [],
          )
        : Object.keys(conditions);
    for (const name of names) attributeOf(this.#model, name);
    return new Relation(this.#executor, this.#model, [...this.#conditions, conditions]);
  }

  async toArray(): Promise<M[]> {
    const { sql, params } = compileSelect({ model: this.#model, conditions: this.#conditions });
    const rows = await this.#executor.all(sql, params);
    return rows.map((row) => hydrate(this.#model, row));
  }
}
