import { InvalidModel } from "./errors.ts";
import type { Executor } from "./executor.ts";
import {
  attributeOf,
  define,
  type AttributeProperties,
  type AttributeDefinition,
  type AttributeSpecs,
} from "./metadata.ts";
import type { Errors } from "./errors-collection.ts";
import { declare, seal } from "./declarations.ts";
import {
  AssociationNotLoaded,
  RecordInvalid,
  RecordNotDestroyed,
  RecordNotSaved,
  UnknownAssociation,
} from "./errors.ts";
import { destroyLifecycle, reloadRecord, saveLifecycle, validateRecord } from "./lifecycle.ts";
import { associationsOf, declarationIn, newRecord, probeOf } from "./association-fields.ts";
import { RecordStatement } from "./record-statement.ts";
import { inferTableNames, rejectAbstract, requireTableName } from "./table-names.ts";
import { RecordState, state, type Changes } from "./record-state.ts";
import type { AssociationDefinition, BelongsTo, HasMany, HasOne } from "./associations.ts";
import type { Relation, Scope } from "./relation.ts";
import type { Validation, ValidationOptions } from "./validations.ts";

/** Any Model's scope, whatever its record type and arguments. */
type AnyScope = (relation: never, ...args: never[]) => unknown;

/**
 * Type-only key carrying the scopes a Model inherits from an app's base class (`ApplicationRecord`'s
 * `Base`), kept apart from its own `scopes` so declaring those adds to them; never set at runtime.
 */
declare const inheritedScopes: unique symbol;

/** The scopes a class declares itself, with `defineScopes`. */
type OwnScopesOf<C> = C extends { scopes: infer S }
  ? string extends keyof S
    ? {} // only the base class's catch-all type: no declared scopes
    : S
  : {};

/** A Model class's scopes: its own, and those it inherits from an app's base class. */
export type ScopesOf<C> = OwnScopesOf<C> &
  (C extends { readonly [inheritedScopes]?: infer I } ? NonNullable<I> : {});

/** A Model's association by name; `UnknownAssociation` for any other name. */
export function associationOf(model: ModelClass, name: string): AssociationDefinition {
  const definition = associationsOf(model)[name];
  if (definition === undefined) {
    throw new UnknownAssociation(`${model.name} has no association "${name}"`);
  }
  return definition;
}

/** What `loaded()` returns for an association accessor: its records, or its record or null. */
export type LoadedValue<F> = F extends () => Promise<infer R>
  ? R
  : F extends () => { toArray(): Promise<infer T> }
    ? T
    : never;

/** The names of a record's association accessors (from their fields' types). */
export type AssociationName<R> = {
  [K in keyof R]: R[K] extends BelongsTo<ModelClass> | HasOne<ModelClass> | HasMany<ModelClass>
    ? K
    : never;
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

export class ModelBase {
  /** The table's name: inferred from the class name (`BlogPost` → `blog_posts`) unless set. */
  static tableName: string;
  static primaryKey = "id";
  static attributeDefinitions: ReadonlyMap<string, AttributeDefinition> = new Map();
  /** This Model's scopes, from `static scopes = this.defineScopes({...})`. */
  static scopes: Readonly<Record<string, AnyScope>> = {};

  /**
   * Declares scopes: `static scopes = this.defineScopes({ active: (q) => q.where(...) })`.
   * A subclass's scopes are added to its parent's (a same-named one replaces the parent's).
   */
  // Constrained on the constructor only: `C`'s static side includes the `scopes` being defined.
  static defineScopes<
    C extends abstract new () => ModelBase,
    S extends Record<string, Scope<InstanceType<C>>>,
  >(this: C, scopes: S): S {
    const inherited = (this as unknown as typeof ModelBase).scopes;
    return { ...inherited, ...scopes } as S;
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

  /** Runs before the validators, e.g. to normalize input. May `throw abort(reason)`. */
  static beforeValidation<C extends ModelClass>(
    this: C,
    callback: Callback<InstanceType<C>>,
  ): void {
    declare(this, "beforeValidation", callback as Callback<ModelBase>);
  }

  /** Runs after the validators, whether or not they passed. May `throw abort(reason)`. */
  static afterValidation<C extends ModelClass>(this: C, callback: Callback<InstanceType<C>>): void {
    declare(this, "afterValidation", callback as Callback<ModelBase>);
  }

  /** Runs before every save (create or update), after validation. May `throw abort(reason)`. */
  static beforeSave<C extends ModelClass>(this: C, callback: Callback<InstanceType<C>>): void {
    declare(this, "beforeSave", callback as Callback<ModelBase>);
  }

  /** Runs before inserting a new record, after `beforeSave`. May `throw abort(reason)`. */
  static beforeCreate<C extends ModelClass>(this: C, callback: Callback<InstanceType<C>>): void {
    declare(this, "beforeCreate", callback as Callback<ModelBase>);
  }

  /** Runs before updating a persisted record, after `beforeSave`. May `throw abort(reason)`. */
  static beforeUpdate<C extends ModelClass>(this: C, callback: Callback<InstanceType<C>>): void {
    declare(this, "beforeUpdate", callback as Callback<ModelBase>);
  }

  /** Runs after a new record was inserted, before `afterSave`. */
  static afterCreate<C extends ModelClass>(this: C, callback: Callback<InstanceType<C>>): void {
    declare(this, "afterCreate", callback as Callback<ModelBase>);
  }

  /** Runs after a persisted record was saved (even with nothing to write), before `afterSave`. */
  static afterUpdate<C extends ModelClass>(this: C, callback: Callback<InstanceType<C>>): void {
    declare(this, "afterUpdate", callback as Callback<ModelBase>);
  }

  /** Runs after every successful save; the record is already persisted and clean. */
  static afterSave<C extends ModelClass>(this: C, callback: Callback<InstanceType<C>>): void {
    declare(this, "afterSave", callback as Callback<ModelBase>);
  }

  /** Runs before deleting the row. May `throw abort(reason)` to refuse the destroy. */
  static beforeDestroy<C extends ModelClass>(this: C, callback: Callback<InstanceType<C>>): void {
    declare(this, "beforeDestroy", callback as Callback<ModelBase>);
  }

  /** Runs after the row was deleted; the record is already destroyed. */
  static afterDestroy<C extends ModelClass>(this: C, callback: Callback<InstanceType<C>>): void {
    declare(this, "afterDestroy", callback as Callback<ModelBase>);
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
    const cached = this[state].cachedAssociation(name);
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
    return this[state].cachedAssociation(name) !== undefined;
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

  /** The loaded attributes as JSON-ready values (dates as ISO strings), for `Response.json(record)`. */
  toJSON(): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(this[state].attributes()).map(([name, value]) => [
        name,
        value instanceof Date ? value.toISOString() : value,
      ]),
    );
  }
}

/** Constructor type for any Model class, used wherever the library accepts one. */
export type ModelClass<M extends ModelBase = ModelBase> = (new () => M) &
  Omit<typeof ModelBase, "prototype">;

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
  Omit<B, "prototype" | "scopes"> & {
    scopes: Readonly<Record<string, AnyScope>>;
    readonly [inheritedScopes]?: ScopesOf<B>;
  };

/**
 * Creates a Model base class whose records have the given attributes.
 * The attribute object is the single source of truth (ADR-0007).
 */
export function Model<const A extends AttributeSpecs>(specs: A): ModelBaseFor<A> {
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

// Module-level, but not request state (ADR-0003): it only remembers which Model
// classes have passed verifyModel(). Concurrent requests at worst verify twice.
const verified = new WeakSet<object>();

/** Checks a Model's declaration the first time it's used; throws `InvalidModel`. */
export function verifyModel(model: ModelClass): void {
  if (verified.has(model)) return;
  rejectAbstract(model);
  requireTableName(model);
  requirePrimaryKeyAttribute(model);
  rejectReservedAttributeNames(model);
  rejectShadowingFields(model);
  seal(model);
  verified.add(model);
}

function requirePrimaryKeyAttribute(model: ModelClass): void {
  if (!model.attributeDefinitions.has(model.primaryKey)) {
    throw new InvalidModel(
      `${model.name}'s primaryKey "${model.primaryKey}" isn't a declared attribute; ` +
        "declare it in Model({...}) or set `static primaryKey`",
    );
  }
}

function rejectReservedAttributeNames(model: ModelClass): void {
  for (const name of model.attributeDefinitions.keys()) {
    if (name in ModelBase.prototype) {
      throw new InvalidModel(
        `${model.name} declares an attribute "${name}", which is the name of a record method or property; ` +
          "rename the attribute and map it with { column }",
      );
    }
  }
}

function rejectShadowingFields(model: ModelClass): void {
  const probe = probeOf(model) as unknown as Record<string, unknown>;
  for (const name of model.attributeDefinitions.keys()) {
    // An association field with an attribute's name is reported when associations are checked.
    if (Object.hasOwn(probe, name) && declarationIn(probe[name]) === undefined) {
      throw new InvalidModel(
        `${model.name} declares a class field "${name}" that hides the attribute's accessor; ` +
          "remove it (attributes are declared in Model({...}))",
      );
    }
  }
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
