import {
  compileColumns,
  compileCount,
  compileSelect,
  Either,
  Negated,
  type Condition,
  type OrderDirection,
  type OrderTerm,
  type SelectQuery,
} from "./compiler.ts";
import { IncompatibleRelation, RecordNotFound } from "./errors.ts";
import type { Executor } from "./executor.ts";
import {
  attributeOf,
  hydrate,
  type AttributesOf,
  type ModelBase,
  type ModelClass,
} from "./model.ts";
import { readValue } from "./conversion.ts";
import { ColumnReference, SafeSql } from "./sql.ts";

/**
 * Attribute conditions for `where`/`findBy`: a value, or an array meaning "any of these".
 * `null` (alone or in an array) matches NULL, and is only allowed for nullable attributes.
 */
export type Conditions<M> = {
  [K in keyof AttributesOf<M>]?: AttributesOf<M>[K] | readonly AttributesOf<M>[K][];
};

/** `{ attribute: "asc" | "desc" }`; key order sets precedence. */
export type OrderSpec<M> = { [K in keyof AttributesOf<M>]?: OrderDirection };

/** Everything but the conditions: what `or` requires to match and `merge` may replace. */
const SHAPE_CLAUSES = ["select", "order", "limit", "offset", "distinct"] as const;

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

  where(conditions: Conditions<M> | SafeSql): Relation<M> {
    this.#check(conditions, "where");
    return this.#with({ conditions: [...this.#query.conditions, conditions] });
  }

  /** Negates the whole condition: `NOT (…)`. Rows where it is NULL are excluded too. */
  whereNot(conditions: Conditions<M> | SafeSql): Relation<M> {
    this.#check(conditions, "whereNot");
    return this.#with({ conditions: [...this.#query.conditions, new Negated(conditions)] });
  }

  /**
   * Rows matching this Relation's conditions or `other`'s. Both must be of the same Model and
   * identical in everything but their conditions (select, order, limit, offset, distinct).
   */
  or(other: Relation<M>): Relation<M> {
    this.#requireSameModel(other, "or");
    for (const clause of SHAPE_CLAUSES) {
      if (JSON.stringify(this.#query[clause]) !== JSON.stringify(other.#query[clause])) {
        throw new IncompatibleRelation(
          `or() needs relations that differ only in their conditions, but their ${clause} differs`,
        );
      }
    }
    const either = new Either(this.#query.conditions, other.#query.conditions);
    return this.#with({ conditions: [either] });
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

  limit(count: number): Relation<M> {
    return this.#with({ limit: count });
  }

  offset(count: number): Relation<M> {
    return this.#with({ offset: count });
  }

  /** Loads only these attributes (a partial record); the primary key is always loaded. */
  select(...attributes: (keyof AttributesOf<M> & string)[]): Relation<M> {
    for (const name of attributes) attributeOf(this.#model, name);
    return this.#with({ select: attributes });
  }

  /** Removes duplicate rows (of the selected attributes). */
  distinct(): Relation<M> {
    return this.#with({ distinct: true });
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
  async findBy(conditions: Conditions<M> | SafeSql): Promise<M | null> {
    return this.where(conditions).#takeOne();
  }

  /** Like `findBy`, but throws `RecordNotFound` instead of returning null. */
  async findByOrThrow(conditions: Conditions<M> | SafeSql): Promise<M> {
    const record = await this.findBy(conditions);
    if (record === null) throw new RecordNotFound(`${this.#model.name} not found`);
    return record;
  }

  /** The first record by this Relation's order, or by primary key if it has none. */
  async first(): Promise<M | null> {
    return this.#one(this.#orderOrPrimaryKey());
  }

  /** The last record: the first in the reverse of every order direction. */
  async last(): Promise<M | null> {
    const reversed = this.#orderOrPrimaryKey().map(({ attribute, direction }): OrderTerm => ({
      attribute,
      direction: direction === "asc" ? "desc" : "asc",
    }));
    return this.#one(reversed);
  }

  /** One record in whatever order D1 returns, or null. */
  async take(): Promise<M | null> {
    return this.#one(this.#query.order);
  }

  /** The number of matching rows, or of non-null values of `attribute`. */
  async count(attribute?: keyof AttributesOf<M> & string): Promise<number> {
    const { sql, params } = compileCount(this.#query, attribute);
    const [row] = await this.#executor.all(sql, params);
    return Number(row?.["count"] ?? 0);
  }

  /** Whether any row matches, optionally with extra conditions. */
  async exists(conditions?: Conditions<M> | SafeSql): Promise<boolean> {
    const relation = conditions === undefined ? this : this.where(conditions);
    const { sql, params } = compileSelect({ ...relation.#query, limit: 1 }, "1");
    return (await this.#executor.all(sql, params)).length > 0;
  }

  /** Converted values of one attribute, or tuples of several, in this Relation's order. */
  async pluck<K extends keyof AttributesOf<M> & string>(
    attribute: K,
  ): Promise<AttributesOf<M>[K][]>;
  async pluck<const K extends readonly (keyof AttributesOf<M> & string)[]>(
    ...attributes: K
  ): Promise<{ [I in keyof K]: AttributesOf<M>[K[I]] }[]>;
  async pluck(...attributes: string[]): Promise<unknown[]> {
    const definitions = attributes.map((name) => attributeOf(this.#model, name));
    const { sql, params } = compileSelect(this.#query, compileColumns(this.#model, attributes));
    const rows = await this.#executor.all(sql, params);
    const values = rows.map((row) =>
      definitions.map(({ type, column }) => readValue(type, row[column])),
    );
    return attributes.length === 1 ? values.map(([value]) => value) : values;
  }

  async toArray(): Promise<M[]> {
    return this.#load(this.#query);
  }

  #requireSameModel(other: Relation<ModelBase>, method: string): void {
    if (other.#model !== this.#model) {
      throw new IncompatibleRelation(
        `${method}() needs relations of the same Model, not ${this.#model.name} and ${other.#model.name}`,
      );
    }
  }

  /** Rejects plain strings and unknown attributes when the condition is written, not when it runs. */
  #check(conditions: Conditions<M> | SafeSql, method: string): void {
    if (typeof conditions !== "object" || conditions === null || Array.isArray(conditions)) {
      throw new TypeError(
        `${method}() takes an object of attribute values or an sql\`…\` fragment; plain strings are not accepted`,
      );
    }
    const names =
      conditions instanceof SafeSql
        ? conditions.values.flatMap((value) =>
            value instanceof ColumnReference ? [value.attribute] : [],
          )
        : Object.keys(conditions);
    for (const name of names) attributeOf(this.#model, name);
  }

  #with(changes: Partial<SelectQuery>): Relation<M> {
    return new Relation(this.#executor, this.#model, { ...this.#query, ...changes });
  }

  async #load(query: SelectQuery): Promise<M[]> {
    // A partial record keeps its primary key, so it keeps its identity — except after
    // distinct(), where adding the key would make every row distinct.
    const { primaryKey } = this.#model;
    const loaded =
      query.select && !query.distinct
        ? [primaryKey, ...query.select.filter((name) => name !== primaryKey)]
        : query.select;
    const { sql, params } = compileSelect(query, compileColumns(this.#model, loaded));
    const rows = await this.#executor.all(sql, params);
    return rows.map((row) => hydrate(this.#model, row));
  }

  #orderOrPrimaryKey(): readonly OrderTerm[] {
    const { order } = this.#query;
    return order.length > 0 ? order : [{ attribute: this.#model.primaryKey, direction: "asc" }];
  }

  async #one(order: readonly OrderTerm[]): Promise<M | null> {
    const [record] = await this.#load({ ...this.#query, order, limit: 1 });
    return record ?? null;
  }

  /** One matching row by the finder rules: keeps conditions, ignores order and pagination. */
  async #takeOne(extra?: Condition): Promise<M | null> {
    const conditions =
      extra === undefined ? this.#query.conditions : [...this.#query.conditions, extra];
    const [record] = await this.#load({ model: this.#model, conditions, order: [], limit: 1 });
    return record ?? null;
  }
}
