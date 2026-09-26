import {
  compileColumns,
  compileCount,
  compileSelect,
  Either,
  Negated,
  type Condition,
  type OrderDirection,
  type CompiledQuery,
  type OrderTerm,
  type SelectQuery,
} from "./compiler.ts";
import { IncompatibleRelation, RecordNotFound } from "./errors.ts";
import type { Executor } from "./executor.ts";
import { attributeOf } from "./metadata.ts";
import {
  buildRecord,
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

type ShapeClause = (typeof SHAPE_CLAUSES)[number];

/** Whether two queries agree on one shape clause, by that clause's own rule. */
function sameClause(clause: ShapeClause, a: SelectQuery, b: SelectQuery): boolean {
  switch (clause) {
    case "select":
      return sameList(a.select, b.select, (x, y) => x === y);
    case "order":
      return sameList(
        a.order,
        b.order,
        (x, y) => x.attribute === y.attribute && x.direction === y.direction,
      );
    default:
      return Object.is(a[clause], b[clause]);
  }
}

function sameList<T>(
  a: readonly T[] | undefined,
  b: readonly T[] | undefined,
  same: (x: T, y: T) => boolean,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.length === b.length && a.every((item, index) => same(item, b[index] as T));
}

/** Whether a clause was set explicitly; an empty order or an unset flag counts as not set. */
function isSet(query: SelectQuery, clause: ShapeClause): boolean {
  const value = query[clause];
  return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== false;
}

function requireConditionObject(conditions: unknown, method: string): void {
  if (typeof conditions !== "object" || conditions === null || Array.isArray(conditions)) {
    throw new TypeError(
      `${method}() takes an object of attribute values or an sql\`…\` fragment; plain strings are not accepted`,
    );
  }
}

/** An undefined value (alone or in an array) would bind NULL into `= ?` and match nothing. */
function rejectUndefined(value: unknown, name: string, method: string): void {
  if (value === undefined || (Array.isArray(value) && value.includes(undefined))) {
    throw new TypeError(
      `${method}() got undefined for "${name}"; use null to match NULL, or leave the key out`,
    );
  }
}

/**
 * The single equality values of a Relation's `where` conditions (a value or null), which a
 * record built from it starts with. Arrays, `whereNot`, `or` and fragments carry nothing over.
 */
function inheritedAttributes(conditions: readonly Condition[]): Record<string, unknown> {
  const inherited: Record<string, unknown> = {};
  for (const condition of conditions) {
    if (
      condition instanceof SafeSql ||
      condition instanceof Negated ||
      condition instanceof Either
    ) {
      continue;
    }
    for (const [name, value] of Object.entries(condition)) {
      if (!Array.isArray(value)) inherited[name] = value;
    }
  }
  return inherited;
}

/** `{}` adds no condition at all (common when an object is built from optional filters). */
function isEmptyConditions(conditions: object): boolean {
  return !(conditions instanceof SafeSql) && Object.keys(conditions).length === 0;
}

/** One record from the page: `limit(0)` stays empty, and `offset` is kept by the caller. */
function atMostOne(limit: number | undefined): number {
  return Math.min(limit ?? 1, 1);
}

declare const scopeTypes: unique symbol;

/** The library's key for running a scope on a Relation; not exported from the package. */
export const applyScope = Symbol("applyScope");

/** A scope: receives the current Relation and its arguments, and returns a changed Relation. */
// oxlint-disable-next-line typescript/no-explicit-any -- scope arguments are the scope's own business
export type Scope<M extends ModelBase> = (relation: Relation<M>, ...args: any[]) => Relation<M>;

/** The scope methods a Model's scopes `S` add to its Relations: `active()`, `createdAfter(date)`. */
export type ScopeMethods<M extends ModelBase, S> = {
  [K in keyof S]: S[K] extends (relation: never, ...args: infer A) => unknown
    ? (...args: A) => Scoped<M, S>
    : never;
};

/** A Relation of Model records `M` with the Model's scope methods `S`. */
export type Scoped<M extends ModelBase, S = {}> = [keyof S] extends [never]
  ? Relation<M, S>
  : Relation<M, S> & ScopeMethods<M, S>;

/** A lazy, immutable description of a query against one Model. */
export class Relation<M extends ModelBase, S = {}> {
  /** Type-only: the Model's scopes, so chained calls keep their scope methods. */
  declare readonly [scopeTypes]?: S;

  readonly #executor: Executor;
  readonly #model: ModelClass<M>;
  readonly #query: SelectQuery;

  constructor(executor: Executor, model: ModelClass<M>, query?: SelectQuery) {
    this.#executor = executor;
    this.#model = model;
    this.#query = query ?? { model, conditions: [], order: [] };
  }

  where(conditions: Conditions<M> | SafeSql): Scoped<M, S> {
    this.#checkConditions(conditions, "where");
    if (isEmptyConditions(conditions)) return this.#scoped(this);
    return this.#with({ conditions: [...this.#query.conditions, conditions] });
  }

  /** Negates the whole condition: `NOT (…)`. Rows where it is NULL are excluded too. */
  whereNot(conditions: Conditions<M> | SafeSql): Scoped<M, S> {
    this.#checkConditions(conditions, "whereNot");
    if (isEmptyConditions(conditions)) return this.#scoped(this);
    return this.#with({ conditions: [...this.#query.conditions, new Negated(conditions)] });
  }

  /** A Relation that matches nothing and never queries D1; it stays empty when chained. */
  none(): Scoped<M, S> {
    return this.#with({ none: true });
  }

  /**
   * Rows matching this Relation's conditions or `other`'s. Both must be of the same Model and
   * identical in everything but their conditions (select, order, limit, offset, distinct).
   */
  or(other: Relation<M, S>): Scoped<M, S> {
    this.#requireSameModel(other, "or");
    if (this.#query.none) return this.#scoped(other);
    if (other.#query.none) return this.#scoped(this);
    for (const clause of SHAPE_CLAUSES) {
      if (!sameClause(clause, this.#query, other.#query)) {
        throw new IncompatibleRelation(
          `or() needs relations that differ only in their conditions, but their ${clause} differs`,
        );
      }
    }
    const either = new Either(this.#query.conditions, other.#query.conditions);
    return this.#with({ conditions: [either] });
  }

  /**
   * ANDs `other`'s conditions onto this Relation's. For select, order, limit, offset and
   * distinct, a clause `other` sets explicitly replaces this one's; one it doesn't set is kept.
   * Orders are replaced, not concatenated (a deliberate difference from Rails).
   */
  merge(other: Relation<M, S>): Scoped<M, S> {
    this.#requireSameModel(other, "merge");
    const theirs = other.#query;
    const changes: Partial<SelectQuery> = {
      conditions: [...this.#query.conditions, ...theirs.conditions],
      ...(theirs.none === true && { none: true }),
    };
    for (const clause of SHAPE_CLAUSES) {
      if (isSet(theirs, clause)) Object.assign(changes, { [clause]: theirs[clause] });
    }
    return this.#with(changes);
  }

  /** Sorts by each key in turn; repeated calls append. */
  order(spec: OrderSpec<M>): Scoped<M, S> {
    const terms: OrderTerm[] = Object.entries(spec).map(([attribute, direction]) => {
      attributeOf(this.#model, attribute);
      if (direction !== "asc" && direction !== "desc") {
        throw new TypeError(`order() direction for "${attribute}" must be "asc" or "desc"`);
      }
      return { attribute, direction };
    });
    return this.#with({ order: [...this.#query.order, ...terms] });
  }

  limit(count: number): Scoped<M, S> {
    return this.#with({ limit: count });
  }

  offset(count: number): Scoped<M, S> {
    return this.#with({ offset: count });
  }

  /** Loads only these attributes (a partial record); the primary key is always loaded. */
  select(...attributes: (keyof AttributesOf<M> & string)[]): Scoped<M, S> {
    for (const name of attributes) attributeOf(this.#model, name);
    return this.#with({ select: attributes });
  }

  /** Removes duplicate rows (of the selected attributes). */
  distinct(): Scoped<M, S> {
    return this.#with({ distinct: true });
  }

  /** A new, unsaved record of this Relation's Model. */
  build(attributes: Partial<AttributesOf<M>> = {}): M {
    const inherited = inheritedAttributes(this.#query.conditions);
    return buildRecord(this.#model, { ...inherited, ...attributes }, this.#executor);
  }

  /** Builds and saves a record; resolves to it whether or not it was saved (check `isPersisted()`). */
  async create(attributes: Partial<AttributesOf<M>> = {}): Promise<M> {
    const record = this.build(attributes);
    await record.save();
    return record;
  }

  /** Builds and saves a record, throwing if it can't be saved. */
  async createOrThrow(attributes: Partial<AttributesOf<M>> = {}): Promise<M> {
    const record = this.build(attributes);
    await record.saveOrThrow();
    return record;
  }

  /** The record with this primary key, keeping this Relation's conditions. */
  async find(id: string | number): Promise<M> {
    const record = await this.#findOne({ [this.#model.primaryKey]: id });
    if (record === null) {
      throw new RecordNotFound(
        `${this.#model.name} with ${this.#model.primaryKey} ${id} not found`,
      );
    }
    return record;
  }

  /** The first record matching `conditions` (in no particular order), or null. */
  async findBy(conditions: Conditions<M> | SafeSql): Promise<M | null> {
    return this.where(conditions).#findOne();
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

  /**
   * The last record: the first in the reverse of every order direction. With `limit`/`offset`,
   * the last record of that page (loaded, then taken from the end).
   */
  async last(): Promise<M | null> {
    const { limit, offset } = this.#query;
    if (limit !== undefined || offset !== undefined) {
      const page = await this.#load({ ...this.#query, order: this.#orderOrPrimaryKey() });
      return page.at(-1) ?? null;
    }
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

  /** The number of matching records, or of non-null values of `attribute`. */
  async count(attribute?: keyof AttributesOf<M> & string): Promise<number> {
    const { sql, params } = compileCount(this.#query, attribute);
    const [row] = await this.#all({ sql, params });
    return Number(row?.["count"] ?? 0);
  }

  /** Whether any record matches, optionally with extra conditions. */
  async exists(conditions?: Conditions<M> | SafeSql): Promise<boolean> {
    const relation = conditions === undefined ? this : this.where(conditions);
    const query = { ...relation.#query, limit: atMostOne(relation.#query.limit) };
    const { sql, params } = compileSelect(query, "1");
    return (await this.#all({ sql, params })).length > 0;
  }

  /** Converted values of one attribute, or tuples of several, in this Relation's order. */
  async pluck<K extends keyof AttributesOf<M> & string>(
    attribute: K,
  ): Promise<AttributesOf<M>[K][]>;
  async pluck<
    const K extends readonly [
      keyof AttributesOf<M> & string,
      keyof AttributesOf<M> & string,
      ...(keyof AttributesOf<M> & string)[],
    ],
  >(...attributes: K): Promise<{ -readonly [I in keyof K]: AttributesOf<M>[K[I]] }[]>;
  async pluck(...attributes: string[]): Promise<unknown[]> {
    if (attributes.length === 0) throw new TypeError("pluck() needs at least one attribute");
    const definitions = attributes.map((name) => attributeOf(this.#model, name));
    const { sql, params } = compileSelect(this.#query, compileColumns(this.#model, attributes));
    const rows = await this.#all({ sql, params });
    const values = rows.map((row) =>
      definitions.map(({ type, column }) => readValue(type, row[column])),
    );
    return attributes.length === 1 ? values.map(([value]) => value) : values;
  }

  async toArray(): Promise<M[]> {
    return this.#load(this.#query);
  }

  #requireSameModel(other: Relation<M, S>, method: string): void {
    if (other.#model !== this.#model) {
      throw new IncompatibleRelation(
        `${method}() needs relations of the same Model, not ${this.#model.name} and ${other.#model.name}`,
      );
    }
    if (other.#executor !== this.#executor) {
      throw new IncompatibleRelation(
        `${method}() needs relations on the same Database; these come from two connect() calls`,
      );
    }
  }

  /**
   * Validates conditions when they're written, not when they run: rejects plain strings,
   * unknown attributes, and undefined values (which would otherwise silently match nothing).
   */
  #checkConditions(conditions: Conditions<M> | SafeSql, method: string): void {
    requireConditionObject(conditions, method);
    if (conditions instanceof SafeSql) {
      for (const value of conditions.values) {
        if (value instanceof ColumnReference) attributeOf(this.#model, value.attribute);
      }
      return;
    }
    for (const [name, value] of Object.entries(conditions)) {
      attributeOf(this.#model, name);
      rejectUndefined(value, name, method);
    }
  }

  /** The one place a Relation runs SQL; a `none()` relation never reaches D1. */
  async #all({ sql, params }: CompiledQuery): Promise<Record<string, unknown>[]> {
    return this.#query.none ? [] : this.#executor.all(sql, params);
  }

  /** Runs a scope on this Relation, checking that it returned a Relation of the same Model. */
  [applyScope](name: string, scope: Scope<M>, args: unknown[]): Relation<M> {
    const result: unknown = scope(this as Relation<M>, ...args);
    if (!(result instanceof Relation) || result.#model !== this.#model) {
      const model = this.#model.name;
      throw new TypeError(
        `${model} scope "${name}" must return a Relation of ${model}, e.g. (q) => q.where(...)`,
      );
    }
    // Otherwise the query would silently run on another connection.
    if (result.#executor !== this.#executor) {
      throw new TypeError(
        `${this.#model.name} scope "${name}" must return a Relation on the same Database it was called on`,
      );
    }
    return result as Relation<M>;
  }

  /**
   * `relation` typed with its scope methods. Sound because every Relation is made by
   * `relationFor` (the constructor needs the internal Executor), whose class has them.
   */
  #scoped(relation: Relation<M, S>): Scoped<M, S> {
    return relation as unknown as Scoped<M, S>;
  }

  /** A copy with `changes`, of this same class, so a Model's scope methods survive chaining. */
  #with(changes: Partial<SelectQuery>): Scoped<M, S> {
    const Class = this.constructor as new (...args: RelationArgs<M>) => Scoped<M, S>;
    return new Class(this.#executor, this.#model, { ...this.#query, ...changes });
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
    const rows = await this.#all({ sql, params });
    return rows.map((row) => hydrate(this.#model, row, this.#executor));
  }

  #orderOrPrimaryKey(): readonly OrderTerm[] {
    const { order } = this.#query;
    return order.length > 0 ? order : [{ attribute: this.#model.primaryKey, direction: "asc" }];
  }

  async #one(order: readonly OrderTerm[]): Promise<M | null> {
    const [record] = await this.#load({
      ...this.#query,
      order,
      limit: atMostOne(this.#query.limit),
    });
    return record ?? null;
  }

  /** One matching row by the finder rules: keeps conditions, ignores order and pagination. */
  async #findOne(extra?: Condition): Promise<M | null> {
    const conditions =
      extra === undefined ? this.#query.conditions : [...this.#query.conditions, extra];
    const [record] = await this.#load({ model: this.#model, conditions, order: [], limit: 1 });
    return record ?? null;
  }
}

/** The Relation constructor's arguments. */
export type RelationArgs<M extends ModelBase> = [
  executor: Executor,
  model: ModelClass<M>,
  query?: SelectQuery,
];

/** One Relation class per Model, holding its scopes as methods; made on first use and cached. */
