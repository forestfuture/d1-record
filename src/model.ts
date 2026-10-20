// `Model({...})` and `ModelBase`: the record class, its statics, and its attribute accessors.
import type { Executor, QueryListener } from "./executor.ts";
import {
  attributeOf,
  define,
  type AttributeProperties,
  type AttributeDefinition,
  type AttributeSpecs,
  type ExactSpecs,
} from "./metadata.ts";
import { type Permitted, permitted } from "./permit.ts";
import { type AttributeConversions, conversionsFor } from "./attribute-conversions.ts";
import { defaultFilterAttributes, type FilterAttribute } from "./filtering.ts";
import type { Errors } from "./errors-collection.ts";
import { declare } from "./declarations.ts";
import {
  AssociationNotLoaded,
  RecordInvalid,
  RecordNotDestroyed,
  RecordNotSaved,
} from "./errors.ts";
import { destroyLifecycle, reloadRecord, saveLifecycle, validateRecord } from "./lifecycle.ts";
import { associationOf, newRecord } from "./association-fields.ts";
import { RecordStatement } from "./record-statement.ts";
import { inferTableNames } from "./table-names.ts";
import { RecordState, state, type Changes } from "./record-state.ts";
import { inspectCustom, type Inspect, type InspectOptions } from "./inspect-support.ts";
import { inspectRecord } from "./record-inspect.ts";
import { readyModel, type BelongsTo, type HasOne } from "./associations.ts";
import type { Relation, Scope, Scoped } from "./relation.ts";
import { defineStatics, ModelStatics } from "./model-statics.ts";
import { currentRelation } from "./current-database.ts";
import { scopeBodies, scopeName, useModelBase } from "./scoped-relation.ts";
import type { Validation, ValidationOptions } from "./validations.ts";

/** Type-only brand on a scope static (`static newest = this.scope(…)`); never set at runtime. */
declare const scopeBrand: unique symbol;

/**
 * A scope, as a static on its Model: called on that Model or any class extending it
 * (`Product.newest()`), it returns a Relation of that class, with all its scopes.
 */
export type ScopeStatic<A extends unknown[]> = (<C extends ModelClass>(
  this: C,
  ...args: A
) => Scoped<InstanceType<C>, ScopesOf<C>>) & { readonly [scopeBrand]: true };

/** A Model class's scopes: its statics made with `this.scope(…)`, its own and inherited. */
export type ScopesOf<C> = {
  // Not `prototype`: that's the record type, whose association fields lead back to other Models.
  [
    K in Exclude<keyof C, "prototype"> as C[K] extends { readonly [scopeBrand]: true } ? K : never
  ]: C[K];
};

/** What `loaded()` returns for an association accessor: its records, or its record or null. */
export type LoadedValue<F> = F extends () => Promise<infer R>
  ? R
  : F extends () => { toArray(): Promise<infer T> }
    ? T
    : never;

/**
 * Any association accessor, whatever its target: by shape, since a Relation of one Model isn't
 * assignable to a Relation of the library's base class.
 */
// oxlint-disable-next-line typescript/no-explicit-any -- any Model's association
type AnyAssociation = BelongsTo<any> | HasOne<any> | (() => Relation<any, any>);

/** The names of a record's association accessors (from their fields' types). */
export type AssociationName<R> = {
  [K in keyof R]: R[K] extends AnyAssociation ? K : never;
}[keyof R] &
  string;

/** A lifecycle callback; it receives the record and may be async. */
export type Callback<R> = (record: R) => unknown;

/** Type-only key carrying a record's declared attribute types; never set at runtime. */
declare const attributeTypes: unique symbol;

/** An attribute's name on record type `R`. */
type AttributeKey<R> = keyof AttributesOf<R> & string;

/** `from`/`to` for the change checks: only matching when the value was, or became, this. */
export interface ChangeOptions<V = unknown> {
  from?: V;
  to?: V;
}

/** The declared attributes of a record type, excluding methods and getters. */
export type AttributesOf<M> = M extends { readonly [attributeTypes]?: infer A } ? A : never;

export class ModelBase extends ModelStatics {
  /** The table's name: inferred from the class name (`BlogPost` → `blog_posts`) unless set. */
  static tableName: string;
  static primaryKey = "id";
  static attributeDefinitions: ReadonlyMap<string, AttributeDefinition> = new Map();
  /**
   * The D1 binding this Model queries when there's no request database (`withDatabase`), as
   * Rails' `connects_to`: `static override binding = "DB"`, usually on the app's base class.
   */
  static binding: string | undefined;

  /**
   * An app-wide query listener, as `connect(env.DB, { onQuery })` is a database's: called for
   * every statement of this Model (and those extending it), whichever database runs it, after
   * the database's own. Holds no request state, so it's safe on a class; a request's ID comes
   * from a database opened for it with `withDatabase` (#78).
   */
  static onQuery: QueryListener | undefined;

  /**
   * Attributes whose values listeners and errors show as "[FILTERED]", as Rails'
   * `filter_attributes`: an attribute whose snake_case name holds a string entry (in any
   * case), or matches a RegExp. Rails' defaults; replace them on the app's base class (#83).
   */
  static filterAttributes: readonly FilterAttribute[] = defaultFilterAttributes;

  /**
   * Attribute names `toJSON()` leaves out, so `Response.json(record)` can't send them. Exact
   * names; none by default. `attributes()` still has them (#101).
   */
  static hiddenAttributes: readonly string[] = [];

  /** Records on a page of `paginate()` when it isn't given `perPage` (#100). */
  static perPage = 25;

  /**
   * The most records on a page of `paginate()`: a larger `perPage`, given or declared, is
   * capped at it, since D1 bills every row read.
   */
  static maxPerPage = 100;

  /**
   * Makes the value of an attribute declared with `generateId: true` that wasn't given: a
   * UUID by default. Override it on the app's base class to choose the app's ids
   * (`static override generateId = uuidv7`); it gets the attribute's name, never the record (#99).
   */
  static generateId(_attribute: string): string {
    return crypto.randomUUID();
  }

  /**
   * Declares a scope, as Rails' `scope :active, -> { … }`: `static active = this.scope((q) =>
   * q.where({ isActive: true }))`. It's a static (`User.active()`) and a Relation method
   * (`User.where(…).active()`), inherited like any static. Inside it, `q` has every Relation
   * method, but not the Model's other scopes (their types would refer to themselves).
   */
  static scope<C extends ModelClass, A extends unknown[]>(
    this: C,
    body: (q: Relation<InstanceType<C>>, ...args: A) => Relation<InstanceType<C>>,
  ): ScopeStatic<A> {
    function scoped(this: ModelClass, ...args: unknown[]): unknown {
      const relation = this.all() as unknown as Record<string, (...args: unknown[]) => unknown>;
      return relation[scopeName(this, scoped)]!(...args);
    }
    scopeBodies.set(scoped, body as unknown as Scope<ModelBase>);
    return scoped as unknown as ScopeStatic<A>;
  }

  /**
   * All of this Model's records, as Rails' `Product.all`: a Relation on the current database
   * (the request's, set with `withDatabase`, or else the Model's `binding`).
   */
  static all<C extends ModelClass>(this: C): Scoped<InstanceType<C>, ScopesOf<C>> {
    return currentRelation(this);
  }

  /**
   * Only the named attributes of untrusted input (a JSON body, `FormData` or
   * `URLSearchParams`), as Rails' `params.permit`:
   * `User.create(User.permit(await request.json(), "email", "name"))`. Every other key is
   * dropped, and each value is cast as assigning it would be.
   */
  static permit<C extends ModelClass, K extends AttributeKey<InstanceType<C>>>(
    this: C,
    input: unknown,
    ...names: K[]
  ): Permitted<C, K> {
    return permitted(this, input, names) as Permitted<C, K>;
  }

  /**
   * An attribute's conversions, for SQL d1-record doesn't write, as Rails' `type_for_attribute`:
   * `Post.typeForAttribute("publishedAt").serialize(date)` is what `publishedAt` stores a `Date`
   * as, whatever its `storage`; `cast` and `deserialize` go the other way.
   */
  static typeForAttribute<C extends ModelClass, K extends AttributeKey<InstanceType<C>>>(
    this: C,
    name: K,
  ): AttributeConversions<AttributesOf<InstanceType<C>>[K]> {
    return conversionsFor(this, name);
  }

  /** Declares a validation, e.g. `this.validates("email", { presence: true })` in `static {}`. */
  static validates<C extends ModelClass>(
    this: C,
    attribute: keyof AttributesOf<InstanceType<C>> & string,
    options: ValidationOptions<InstanceType<C>>,
  ): void {
    attributeOf(this, attribute);
    const { uniqueness } = options;
    if (typeof uniqueness === "object") {
      for (const name of uniqueness.scope ?? []) attributeOf(this, name);
    }
    const validation: Validation = { attribute, options: options as ValidationOptions<never> };
    declare(this, "validations", validation);
  }

  /** @internal This record's values, lifecycle and Snapshot; only `RecordState` changes them. */
  readonly [state] = new RecordState(this.constructor as ModelClass);

  /** The errors from the last validation run. */
  get errors(): Errors {
    return this[state].errors;
  }

  /**
   * A loaded association, synchronously: records for a hasMany, a record or null otherwise.
   * Throws `AssociationNotLoaded` unless it was preloaded with `includes(...)` or already read
   * (and its key hasn't changed since).
   */
  loaded<K extends AssociationName<this>>(name: K): LoadedValue<this[K]> {
    const model = this.constructor as ModelClass;
    associationOf(model, name);
    const cached = this[state].associations.get(name);
    if (cached === undefined) {
      throw new AssociationNotLoaded(
        `${model.name} record hasn't loaded "${name}"; preload it with includes("${name}"), or read it first`,
      );
    }
    // A copy of a list, so changing what's returned never changes the cached data.
    const { value } = cached;
    return (Array.isArray(value) ? [...value] : value) as LoadedValue<this[K]>;
  }

  /** Whether the association is loaded: preloaded or already read, for the key held now. */
  isLoaded<K extends AssociationName<this>>(name: K): boolean {
    associationOf(this.constructor as ModelClass, name);
    return this[state].associations.get(name) !== undefined;
  }

  /**
   * Loads the association again, replacing what's cached, and returns it: Rails'
   * `reload_author`, or `user.posts.reload` for a hasMany.
   */
  async reloadAssociation<K extends AssociationName<this>>(name: K): Promise<LoadedValue<this[K]>> {
    const { kind } = associationOf(this.constructor as ModelClass, name);
    this[state].resetAssociation(name);
    // The accessor installed for this association: a Relation for a hasMany, else a promise.
    const accessor = this[name] as () => Relation<ModelBase> | Promise<ModelBase | null>;
    const read = accessor.call(this);
    const value = kind === "hasMany" ? await (read as Relation<ModelBase>).toArray() : await read;
    return value as LoadedValue<this[K]>;
  }

  /** Why a callback last refused a save or destroy (`abort(reason)`); never copied into `errors`. */
  get abortReason(): string | undefined {
    return this[state].abortReason;
  }

  /** Runs every validation, filling `errors` from scratch; `true` if there are none. */
  async isValid(): Promise<boolean> {
    return validateRecord(this);
  }

  /** Whether any attribute differs from its value as last loaded or saved. */
  isChanged(): boolean {
    return this[state].changedNames().length > 0;
  }

  /** The names of the changed attributes. */
  changed(): string[] {
    return this[state].changedNames();
  }

  /** Each changed attribute's value before the change: `{ email: old }`. */
  changedAttributes(): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(this[state].changes()).map(([name, [before]]) => [name, before]),
    );
  }

  /** Each changed attribute's value before and after: `{ email: [old, new] }`. */
  changes(): Changes {
    return this[state].changes();
  }

  /** The changes the last successful save wrote; use it in after-save callbacks. */
  savedChanges(): Changes {
    return this[state].savedChanges();
  }

  /** The attribute's value before its unsaved change, as stored (Rails' `attribute_was`). */
  attributeWas<R extends ModelBase, K extends AttributeKey<R>>(
    this: R,
    name: K,
  ): AttributesOf<R>[K] {
    return this[state].valueInDatabase(name) as AttributesOf<R>[K];
  }

  /**
   * Whether the attribute has an unsaved change, optionally `from` and/or `to` given values
   * (Rails' `attribute_changed?(name, from:, to:)`).
   */
  isAttributeChanged<R extends ModelBase, K extends AttributeKey<R>>(
    this: R,
    name: K,
    options: ChangeOptions<AttributesOf<R>[K]> = {},
  ): boolean {
    return this[state].isAttributeChanged(name, options);
  }

  /** Whether saving now would write a change to the attribute (for before-callbacks). */
  willSaveChangeTo<R extends ModelBase, K extends AttributeKey<R>>(
    this: R,
    name: K,
    options: ChangeOptions<AttributesOf<R>[K]> = {},
  ): boolean {
    return this[state].isAttributeChanged(name, options);
  }

  /** The last save's change to the attribute, `[before, after]`, if it changed (for after-callbacks). */
  savedChangeTo<R extends ModelBase, K extends AttributeKey<R>>(
    this: R,
    name: K,
  ): [before: AttributesOf<R>[K], after: AttributesOf<R>[K]] | undefined {
    this[state].read(name);
    const change = this[state].savedChanges()[name];
    return change === undefined
      ? undefined
      : ([...change] as [AttributesOf<R>[K], AttributesOf<R>[K]]);
  }

  /** Whether the last save changed the attribute, optionally `from` and/or `to` given values. */
  hasSavedChangeTo<R extends ModelBase, K extends AttributeKey<R>>(
    this: R,
    name: K,
    options: ChangeOptions<AttributesOf<R>[K]> = {},
  ): boolean {
    return this[state].hasSavedChangeTo(name, options);
  }

  /** The attribute's value before the last save (its current stored value, if that didn't change it). */
  attributeBeforeLastSave<R extends ModelBase, K extends AttributeKey<R>>(
    this: R,
    name: K,
  ): AttributesOf<R>[K] {
    this[state].read(name);
    const change = this[state].savedChanges()[name];
    return (
      change === undefined ? this[state].valueInDatabase(name) : change[0]
    ) as AttributesOf<R>[K];
  }

  /** Undoes unsaved changes to these attributes (all of them by default), as Rails' `restore_attributes`. */
  restoreAttributes<R extends ModelBase>(this: R, names?: readonly AttributeKey<R>[]): void {
    this[state].restore(names);
  }

  /** Inserts a new record or updates a persisted one; `false` if it's invalid or a callback aborted. */
  async save(): Promise<boolean> {
    return (await saveLifecycle(this)).status === "saved";
  }

  /** Like `save()`, but throws `RecordInvalid` or `RecordNotSaved` instead of returning `false`. */
  async saveOrThrow(): Promise<true> {
    const outcome = await saveLifecycle(this);
    if (outcome.status === "invalid") throw new RecordInvalid(this);
    if (outcome.status === "aborted") throw new RecordNotSaved(outcome.reason);
    return true;
  }

  /** Assigns several attributes without saving. */
  assign(attributes: Partial<AttributesOf<this>>): this {
    this[state].assign(attributes);
    return this;
  }

  /** `assign` then `save`. */
  async update(attributes: Partial<AttributesOf<this>>): Promise<boolean> {
    this[state].requireLive("be updated");
    return this.assign(attributes).save();
  }

  /** `assign` then `saveOrThrow`. */
  async updateOrThrow(attributes: Partial<AttributesOf<this>>): Promise<true> {
    this[state].requireLive("be updated");
    return this.assign(attributes).saveOrThrow();
  }

  /**
   * Deletes the row and resolves to this record, now a read-only destroyed snapshot.
   * A row that's already gone still counts. `false` means a `beforeDestroy` callback aborted.
   */
  async destroy(): Promise<this | false> {
    return (await destroyLifecycle(this)).status === "destroyed" ? this : false;
  }

  /**
   * This record's save, for `db.batch([...])`: its validations and callbacks run when the batch
   * runs, and every record in the batch is written atomically.
   */
  toSave(): RecordStatement<this> {
    return new RecordStatement(this, "save");
  }

  /** This record's destroy, dependents included, for `db.batch([...])`. */
  toDestroy(): RecordStatement<this> {
    return new RecordStatement(this, "destroy");
  }

  /** Like `destroy()`, but throws `RecordNotDestroyed` instead of returning `false`. */
  async destroyOrThrow(): Promise<this> {
    const outcome = await destroyLifecycle(this);
    if (outcome.status !== "destroyed") throw new RecordNotDestroyed(outcome.reason);
    return this;
  }

  /** Loads the stored row again, discarding unsaved changes; `RecordNotFound` if it's gone. */
  async reload(): Promise<this> {
    await reloadRecord(this);
    return this;
  }

  /** Not yet saved: built, or created but not persisted. */
  isNewRecord(): boolean {
    return this[state].isNew;
  }

  /** Backed by a row: loaded, or saved successfully. */
  isPersisted(): boolean {
    return this[state].isPersisted;
  }

  /** Deleted by this instance; a read-only snapshot of the row. */
  isDestroyed(): boolean {
    return this[state].isDestroyed;
  }

  /** The record's attributes as a plain object of JavaScript values. */
  attributes(): Record<string, unknown> {
    return this[state].attributes();
  }

  /** Prints as `Name { attribute: value, … }` in a console, a log or a test failure (#104). */
  [inspectCustom](depth: number, options: InspectOptions, inspect: Inspect): string {
    return inspectRecord(modelOf(this), this[state], { depth, options, inspect });
  }

  /**
   * The loaded attributes as JSON-ready values (dates as ISO strings), without the Model's
   * `hiddenAttributes`, for `Response.json(record)`.
   */
  toJSON(): Record<string, unknown> {
    const { hiddenAttributes } = modelOf(this);
    return Object.fromEntries(
      Object.entries(this[state].attributes())
        .filter(([name]) => !hiddenAttributes.includes(name))
        .map(([name, value]) => [name, value instanceof Date ? value.toISOString() : value]),
    );
  }
}

/** Constructor type for any Model class, used wherever the library accepts one. */
export type ModelClass<M extends ModelBase = ModelBase> = (new () => M) &
  Omit<typeof ModelBase, "prototype">;

defineStatics(ModelBase);

// ModelBase and its statics are all defined now: scopes stop at it, and can't take its names;
// and relationFor makes each Model ready with readyModel (hoisted, so it exists already).
useModelBase(ModelBase, readyModel);

/** A class to build Models on: `Model.Base`, or an app's class extending it (`ApplicationRecord`'s). */
export type BaseClass = abstract new () => ModelBase;

/**
 * The base class `Model({...})` makes: records with the attributes `A`, built on `B` (the
 * library's base, or an app's), so they have its methods and statics too.
 */
export type ModelBaseFor<
  A extends AttributeSpecs,
  B extends BaseClass = typeof ModelBase,
> = (new () => InstanceType<B> &
  AttributeProperties<A> & { readonly [attributeTypes]?: AttributeProperties<A> }) &
  Omit<B, "prototype">;

/**
 * Creates a Model base class whose records have the given attributes.
 * The attribute object is the single source of truth (ADR-0007).
 */
export function Model<const A extends AttributeSpecs>(specs: A & ExactSpecs<A>): ModelBaseFor<A> {
  return defineModel(specs, ModelBase);
}

/**
 * The library's base class, for an app's own (Rails' `ActiveRecord::Base`): methods, statics,
 * callbacks and scopes declared on a class extending it are shared by every Model built on it
 * with `modelFor(tables, Base)`. It's abstract: it has no table, so it's never used directly.
 */
Model.Base = ModelBase;

/** `Model({...})` on `base`: a class with the attributes' accessors, extending `base`. */
export function defineModel<const A extends AttributeSpecs, B extends BaseClass>(
  specs: A,
  base: B,
): ModelBaseFor<A, B> {
  const Parent = base as unknown as typeof ModelBase;
  class DefinedModel extends Parent {
    static override attributeDefinitions: ReadonlyMap<string, AttributeDefinition> = new Map(
      Object.entries(specs).map(([name, spec]) => [name, define(name, spec)]),
    );
  }
  inferTableNames(DefinedModel);
  for (const name of Object.keys(specs)) {
    Object.defineProperty(DefinedModel.prototype, name, {
      get(this: ModelBase) {
        return this[state].read(name);
      },
      set(this: ModelBase, value: unknown) {
        this[state].write(name, value);
      },
    });
  }
  return DefinedModel as never;
}

/** A record's Model: its class. */
export function modelOf(record: ModelBase): ModelClass {
  return record.constructor as ModelClass;
}

/** The record's primary key value. */
export function primaryKeyOf(record: ModelBase): unknown {
  return record[state].read(modelOf(record).primaryKey);
}

/** Builds a persisted record of `model` from a D1 row. */
export function hydrate<M extends ModelBase>(
  model: ModelClass<M>,
  row: Record<string, unknown>,
  executor: Executor,
): M {
  const record = newRecord(model);
  record[state].belongTo(executor);
  record[state].loadRow(row);
  return record;
}

/**
 * A new, unsaved record. Every attribute reads as null until assigned; defaults are
 * evaluated now and count as assigned, and so are the given attributes.
 */
export function buildRecord<M extends ModelBase>(
  model: ModelClass<M>,
  attributes: Record<string, unknown>,
  executor: Executor,
): M {
  const record = newRecord(model);
  record[state].belongTo(executor);
  record[state].build(attributes);
  return record;
}
