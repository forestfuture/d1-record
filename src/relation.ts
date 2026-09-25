import {
  compileSelect,
  type Condition,
  type OrderDirection,
  type OrderTerm,
  type SelectQuery,
} from "./compiler.ts";
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

/** `{ attribute: "asc" | "desc" }`; key order sets precedence. */
export type OrderSpec<M> = { [K in keyof AttributesOf<M>]?: OrderDirection };

/** A lazy, immutable description of a query against one Model. */
export class Relation<M extends ModelBase> {
  readonly #executor: Executor;
  readonly #model: ModelClass<M>;
  readonly #query: SelectQuery;

  constructor(executor: Executor, model: ModelClass<M>, query?: SelectQuery) {
    this.#executor = executor;
    this.#model = model;
    this.#query = query ?? { model, conditions: [], order: [] };
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
    return this.#with({ conditions: [...this.#query.conditions, conditions] });
  }

  /** Sorts by each key in turn; repeated calls append. */
  order(spec: OrderSpec<M>): Relation<M> {
    const terms: OrderTerm[] = Object.entries(spec).map(([attribute, direction]) => {
      attributeOf(this.#model, attribute);
      if (direction !== "asc" && direction !== "desc") {
        throw new TypeError(`order() direction for "${attribute}" must be "asc" or "desc"`);
      }
      return { attribute, direction };
    });
    return this.#with({ order: [...this.#query.order, ...terms] });
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
    return this.#load(this.#query);
  }

  #with(changes: Partial<SelectQuery>): Relation<M> {
    return new Relation(this.#executor, this.#model, { ...this.#query, ...changes });
  }

  async #load(query: SelectQuery): Promise<M[]> {
    const { sql, params } = compileSelect(query);
    const rows = await this.#executor.all(sql, params);
    return rows.map((row) => hydrate(this.#model, row));
  }

  /** One matching row by the finder rules: keeps conditions, ignores order and pagination. */
  async #takeOne(extra?: Condition): Promise<M | null> {
    const conditions =
      extra === undefined ? this.#query.conditions : [...this.#query.conditions, extra];
    const [record] = await this.#load({ model: this.#model, conditions, order: [], limit: 1 });
    return record ?? null;
  }
}
