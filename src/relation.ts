import { compileSelect, type Condition } from "./compiler.ts";
import { RecordNotFound } from "./errors.ts";
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

  /** The record with this primary key, keeping this Relation's conditions. */
  async find(id: string | number): Promise<M> {
    const record = await this.#takeOne({ [this.#model.primaryKey]: id });
    if (record === null) {
      throw new RecordNotFound(
        `${this.#model.name} with ${this.#model.primaryKey} ${id} not found`,
      );
    }
    return record;
  }

  /** The first record matching `conditions` (in no particular order), or null. */
  async findBy(conditions: Partial<AttributesOf<M>> | SafeSql): Promise<M | null> {
    return this.where(conditions).#takeOne();
  }

  /** Like `findBy`, but throws `RecordNotFound` instead of returning null. */
  async findByOrThrow(conditions: Partial<AttributesOf<M>> | SafeSql): Promise<M> {
    const record = await this.findBy(conditions);
    if (record === null) throw new RecordNotFound(`${this.#model.name} not found`);
    return record;
  }

  async toArray(): Promise<M[]> {
    const { sql, params } = compileSelect({ model: this.#model, conditions: this.#conditions });
    const rows = await this.#executor.all(sql, params);
    return rows.map((row) => hydrate(this.#model, row));
  }

  async #takeOne(extra?: Condition): Promise<M | null> {
    const conditions = extra === undefined ? this.#conditions : [...this.#conditions, extra];
    const { sql, params } = compileSelect({ model: this.#model, conditions, limit: 1 });
    const [row] = await this.#executor.all(sql, params);
    return row === undefined ? null : hydrate(this.#model, row);
  }
}
