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
import { RecordInvalid, RecordNotDestroyed, RecordNotSaved } from "./errors.ts";
import { destroyLifecycle, reloadRecord, saveLifecycle, validateRecord } from "./lifecycle.ts";
import { RecordState, state, type Changes } from "./record-state.ts";
import type { Validation, ValidationOptions } from "./validations.ts";

/** A lifecycle callback; it receives the record and may be async. */
export type Callback<R> = (record: R) => unknown;

/** Type-only key carrying a record's declared attribute types; never set at runtime. */
declare const attributeTypes: unique symbol;

/** The declared attributes of a record type, excluding methods and getters. */
export type AttributesOf<M> = M extends { readonly [attributeTypes]?: infer A } ? A : never;

export class ModelBase {
  static tableName: string;
  static primaryKey = "id";
  static attributeDefinitions: ReadonlyMap<string, AttributeDefinition> = new Map();

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

  /** This record's values, lifecycle and Snapshot; only `RecordState` changes them. */
  readonly [state] = new RecordState(this.constructor as ModelClass);

  /** The errors from the last validation run. */
  get errors(): Errors {
    return this[state].errors;
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

  /** Like `destroy()`, but throws `RecordNotDestroyed` instead of returning `false`. */
  async destroyOrThrow(): Promise<this> {
    const outcome = await destroyLifecycle(this);
    if (outcome.status === "aborted") throw new RecordNotDestroyed(outcome.reason);
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

/**
 * Creates a Model base class whose records have the given attributes.
 * The attribute object is the single source of truth (ADR-0007).
 */
export function Model<const A extends AttributeSpecs>(
  specs: A,
): (new () => ModelBase &
  AttributeProperties<A> & { readonly [attributeTypes]?: AttributeProperties<A> }) &
  Omit<typeof ModelBase, "prototype"> {
  class DefinedModel extends ModelBase {
    static override attributeDefinitions: ReadonlyMap<string, AttributeDefinition> = new Map(
      Object.entries(specs).map(([name, spec]) => [name, define(name, spec)]),
    );
  }
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

/** Builds a persisted record of `model` from a D1 row. */
export function hydrate<M extends ModelBase>(
  model: ModelClass<M>,
  row: Record<string, unknown>,
  executor: Executor,
): M {
  const record = new model();
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
  requireTableName(model);
  requirePrimaryKeyAttribute(model);
  rejectReservedAttributeNames(model);
  rejectShadowingFields(model);
  seal(model);
  verified.add(model);
}

function requireTableName(model: ModelClass): void {
  if (typeof model.tableName !== "string" || model.tableName === "") {
    throw new InvalidModel(`${model.name} has no tableName; add \`static tableName = "…"\``);
  }
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
  const probe = new model();
  for (const name of model.attributeDefinitions.keys()) {
    if (Object.hasOwn(probe, name)) {
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
  const record = new model();
  record[state].belongTo(executor);
  record[state].build(attributes);
  return record;
}
