import {
  compileColumns,
  compileCount,
  compileDeleteAll,
  compileSelect,
  compileUpdateAll,
  type Assignment,
  type CompiledQuery,
} from "./compiler.ts";
import { IncompatibleRelation, RecordNotFound, RecordNotSaved } from "./errors.ts";
import { includeTree, keysForIncludes, preload } from "./preload.ts";
import {
  allOf,
  either,
  inheritedAttributes,
  merged,
  mergeTrees,
  Negated,
  type Condition,
  type OrderDirection,
  type OrderTerm,
  type QueryDescription,
} from "./query.ts";
import type { Executor } from "./executor.ts";
import { attributeOf } from "./metadata.ts";
import {
  buildRecord,
  hydrate,
  type AssociationName,
  type AttributesOf,
  type LoadedValue,
  type ModelBase,
  type ModelClass,
} from "./model.ts";
import { readValue } from "./conversion.ts";
import { ColumnReference, SafeSql } from "./sql.ts";
import { insertStatement, Statement } from "./statement.ts";

/**
 * Attribute conditions for `where`/`findBy`: a value, or an array meaning "any of these".
 * `null` (alone or in an array) matches NULL, and is only allowed for nullable attributes.
 */
export type Conditions<M> = {
  [K in keyof AttributesOf<M>]?: AttributesOf<M>[K] | readonly AttributesOf<M>[K][];
};

/** `{ attribute: "asc" | "desc" }`; key order sets precedence. */
export type OrderSpec<M> = { [K in keyof AttributesOf<M>]?: OrderDirection };

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

/** `{}` adds no condition at all (common when an object is built from optional filters). */
function isEmptyConditions(conditions: object): boolean {
  return !(conditions instanceof SafeSql) && Object.keys(conditions).length === 0;
}

/** One record from the page: `limit(0)` stays empty, and `offset` is kept by the caller. */
function atMostOne(limit: number | undefined): number {
  return Math.min(limit ?? 1, 1);
}

declare const scopeTypes: unique symbol;

/** The record type an association accessor loads: `Post` for `HasMany<typeof Post>`. */
type TargetRecord<F> =
  LoadedValue<F> extends readonly (infer T)[] ? T : NonNullable<LoadedValue<F>>;

/**
 * What `includes()` accepts for records `M`: an association name, or `{ name: nested }` where
 * `nested` names associations of that association's records. Checked against `declare` lines.
 */
export type IncludeSpec<M> =
  | AssociationName<M>
  | {
      readonly [K in AssociationName<M>]?:
        | IncludeSpec<TargetRecord<M[K]>>
        | readonly IncludeSpec<TargetRecord<M[K]>>[];
    };

/**
 * What a hasMany Relation knows about its owner. It isn't part of the query, so the compiler
 * never sees it.
 */
export interface OwnerLink {
  /**
   * The target attribute pointing at the owner. `deleteAll()` sets it to NULL rather than
   * deleting, as Rails' has_many does without `dependent:`. Dropped when chained.
   */
  foreignKey?: string;
  /** Why records can't be created through it: its owner has no key yet. Kept when chained. */
  unsavedOwner?: string;
  /** Records already preloaded; `toArray()` answers from them. Dropped when chained. */
  preloaded?: readonly ModelBase[];
}

/** The library's key for making a hasMany Relation of an owner; not exported. */
export const ofOwner = Symbol("ofOwner");

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
  readonly #query: QueryDescription;
  readonly #owner: OwnerLink;

  constructor(
    executor: Executor,
    model: ModelClass<M>,
    query?: QueryDescription,
    owner: OwnerLink = {},
  ) {
    this.#executor = executor;
    this.#model = model;
    this.#query = query ?? allOf(model);
    this.#owner = owner;
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
    return this.#describing(either(this.#query, other.#query));
  }

  /**
   * ANDs `other`'s conditions onto this Relation's. For select, order, limit, offset and
   * distinct, a clause `other` sets explicitly replaces this one's; one it doesn't set is kept.
   * Orders are replaced, not concatenated (a deliberate difference from Rails).
   */
  merge(other: Relation<M, S>): Scoped<M, S> {
    this.#requireSameModel(other, "merge");
    return this.#describing(merged(this.#query, other.#query));
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

  /**
   * Preloads associations for every record this Relation loads, so reading them afterwards
   * sends no query: `includes("posts", "profile")`, nested `includes({ posts: "comments" })`.
   */
  includes(...specs: IncludeSpec<M>[]): Scoped<M, S> {
    const added = includeTree(this.#model, specs);
    return this.#with({ includes: mergeTrees(this.#query.includes ?? {}, added) });
  }

  /**
   * This Relation as a hasMany of an owner: answered from preloaded records, or, for an owner
   * without a key, finding nothing and refusing `create`.
   */
  [ofOwner](owner: OwnerLink): Scoped<M, S> {
    const Class = this.constructor as new (...args: RelationArgs<M>) => Scoped<M, S>;
    const query = owner.unsavedOwner === undefined ? this.#query : { ...this.#query, none: true };
    return new Class(this.#executor, this.#model, query, owner);
  }

  /** A new, unsaved record of this Relation's Model. */
  build(attributes: Partial<AttributesOf<M>> = {}): M {
    const inherited = inheritedAttributes(this.#query.conditions);
    return buildRecord(this.#model, { ...inherited, ...attributes }, this.#executor);
  }

  /** As in Rails, records can't be created through an owner that has no key yet. */
  #requireSavedOwner(): void {
    const reason = this.#owner.unsavedOwner;
    if (reason !== undefined) {
      throw new RecordNotSaved(`You cannot create a ${this.#model.name} here: ${reason}`);
    }
  }

  /**
   * An INSERT statement for one row: `await db.model(Post).insert({ title }).run()`, or inside
   * `db.batch([...])`. Skips validations and callbacks; declared defaults and timestamps apply,
   * and this Relation's equality conditions are inserted too, as with `build()`.
   */
  insert(attributes: Partial<AttributesOf<M>>): Statement {
    this.#requireSavedOwner();
    const inherited = inheritedAttributes(this.#query.conditions);
    return insertStatement(this.#executor, this.#model, { ...inherited, ...attributes });
  }

  /**
   * An UPDATE statement for every row this Relation matches, setting attribute values or an
   * `sql` fragment: ``updateAll(sql`${column("views")} = ${column("views")} + 1`)``. Skips
   * validations and callbacks, and leaves `updatedAt` alone, as in Rails.
   */
  updateAll(changes: Partial<AttributesOf<M>> | SafeSql): Statement {
    const checked = this.#checkChanges(changes);
    return this.#statement(compileUpdateAll(this.#writableQuery("updateAll"), checked));
  }

  /**
   * A DELETE statement for every row this Relation matches. On a hasMany association itself
   * (`user.posts().deleteAll()`), the rows' foreign key is set to NULL instead, as in Rails.
   */
  deleteAll(): Statement {
    const query = this.#writableQuery("deleteAll");
    const { foreignKey } = this.#owner;
    return this.#statement(
      foreignKey === undefined
        ? compileDeleteAll(query)
        : compileUpdateAll(query, [[foreignKey, null]]),
    );
  }

  /** Builds and saves a record; resolves to it whether or not it was saved (check `isPersisted()`). */
  async create(attributes: Partial<AttributesOf<M>> = {}): Promise<M> {
    this.#requireSavedOwner();
    const record = this.build(attributes);
    await record.save();
    return record;
  }

  /** Builds and saves a record, throwing if it can't be saved. */
  async createOrThrow(attributes: Partial<AttributesOf<M>> = {}): Promise<M> {
    this.#requireSavedOwner();
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
    const [row] = await this.#all(compileCount(this.#query, attribute));
    return Number(row?.["count"] ?? 0);
  }

  /** Whether any record matches, optionally with extra conditions. */
  async exists(conditions?: Conditions<M> | SafeSql): Promise<boolean> {
    const relation = conditions === undefined ? this : this.where(conditions);
    const query = { ...relation.#query, limit: atMostOne(relation.#query.limit) };
    return (await this.#all(compileSelect(query, "1"))).length > 0;
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
    const rows = await this.#all(
      compileSelect(this.#query, compileColumns(this.#model, attributes)),
    );
    const values = rows.map((row) =>
      definitions.map(({ type, column }) => readValue(type, row[column])),
    );
    return attributes.length === 1 ? values.map(([value]) => value) : values;
  }

  async toArray(): Promise<M[]> {
    const { preloaded } = this.#owner;
    if (preloaded !== undefined) return [...preloaded] as M[];
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

  /** Attribute changes for `updateAll`, checked like conditions: declared, and not undefined. */
  #checkChanges(changes: Partial<AttributesOf<M>> | SafeSql): Assignment[] | SafeSql {
    this.#checkConditions(changes as Conditions<M> | SafeSql, "updateAll");
    if (changes instanceof SafeSql) return changes;
    const assignments = Object.entries(changes);
    if (assignments.length === 0) {
      throw new TypeError("updateAll() needs at least one attribute to change");
    }
    return assignments;
  }

  /** The query a write statement targets; rows from `distinct()` have no identity to write to. */
  #writableQuery(method: string): QueryDescription {
    if (this.#query.distinct) {
      throw new IncompatibleRelation(`${method}() can't be combined with distinct()`);
    }
    return this.#query;
  }

  #statement(query: CompiledQuery): Statement {
    return new Statement(this.#executor, query);
  }

  /** The one place a Relation runs SQL; a `none()` relation never reaches D1. */
  async #all(query: CompiledQuery): Promise<Record<string, unknown>[]> {
    return this.#query.none ? [] : this.#executor.all(query);
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

  /** A copy with `changes` to its query. */
  #with(changes: Partial<QueryDescription>): Scoped<M, S> {
    return this.#describing({ ...this.#query, ...changes });
  }

  /** A Relation of this same class for `query`, so a Model's scope methods survive chaining. */
  #describing(query: QueryDescription): Scoped<M, S> {
    const Class = this.constructor as new (...args: RelationArgs<M>) => Scoped<M, S>;
    // Preloading needs keys a distinct select leaves out; adding them would undo the distinct.
    if (query.includes !== undefined && query.select !== undefined && query.distinct) {
      throw new IncompatibleRelation(
        "includes() can't be combined with select(...).distinct(): preloading needs keys the distinct select leaves out",
      );
    }
    // A changed query is a new Relation without preloaded records: they'd no longer answer it.
    const { unsavedOwner } = this.#owner;
    return new Class(this.#executor, this.#model, query, { unsavedOwner });
  }

  async #load(query: QueryDescription): Promise<M[]> {
    // A partial record keeps its primary key, so it keeps its identity — except after
    // distinct(), where adding the key would make every row distinct.
    const { primaryKey } = this.#model;
    const loaded =
      query.select && !query.distinct
        ? [
            ...new Set([
              primaryKey,
              ...keysForIncludes(this.#model, query.includes),
              ...query.select,
            ]),
          ]
        : query.select;
    const rows = await this.#all(compileSelect(query, compileColumns(this.#model, loaded)));
    const records = rows.map((row) => hydrate(this.#model, row, this.#executor));
    if (query.includes !== undefined) await preload(records, query.includes, this.#executor);
    return records;
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
    const { includes } = this.#query;
    const query = { model: this.#model, conditions, order: [], limit: 1, includes };
    const [record] = await this.#load(query);
    return record ?? null;
  }
}

/** The Relation constructor's arguments. */
export type RelationArgs<M extends ModelBase> = [
  executor: Executor,
  model: ModelClass<M>,
  query?: QueryDescription,
  owner?: OwnerLink,
];
