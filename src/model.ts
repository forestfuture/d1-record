import { InvalidModel, MissingAttribute } from "./errors.ts";
import type { Executor } from "./executor.ts";
import {
  attributeOf,
  define,
  type AttributeProperties,
  type AttributeDefinition,
  type AttributeSpecs,
} from "./metadata.ts";
import { applyRow, saveRecord } from "./persistence.ts";
import { state, values, type RecordState } from "./record-state.ts";

/** Type-only key carrying a record's declared attribute types; never set at runtime. */
declare const attributeTypes: unique symbol;

/** The declared attributes of a record type, excluding methods and getters. */
export type AttributesOf<M> = M extends { readonly [attributeTypes]?: infer A } ? A : never;

export class ModelBase {
  static tableName: string;
  static primaryKey = "id";
  static attributeDefinitions: ReadonlyMap<string, AttributeDefinition> = new Map();

  [values]: Record<string, unknown> = {};
  [state]: RecordState = { lifecycle: "new", assigned: new Set() };

  /** Inserts a new record or updates a persisted one; `false` only for validation or abort (#4). */
  async save(): Promise<boolean> {
    return saveRecord(this);
  }

  /** Not yet saved: built, or created but not persisted. */
  isNewRecord(): boolean {
    return this[state].lifecycle === "new";
  }

  /** Backed by a row: loaded, or saved successfully. */
  isPersisted(): boolean {
    return this[state].lifecycle === "persisted";
  }

  /** Deleted by this instance; a read-only snapshot of the row. */
  isDestroyed(): boolean {
    return this[state].lifecycle === "destroyed";
  }

  /** The record's attributes as a plain object of JavaScript values. */
  attributes(): Record<string, unknown> {
    return { ...this[values] };
  }

  /** The loaded attributes as JSON-ready values (dates as ISO strings), for `Response.json(record)`. */
  toJSON(): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(this[values]).map(([name, value]) => [
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
        if (!(name in this[values])) {
          throw new MissingAttribute(
            `${this.constructor.name} record has no "${name}" loaded; it was left out of select(...)`,
          );
        }
        return this[values][name];
      },
      set(this: ModelBase, value: unknown) {
        this[values][name] = value;
        this[state].assigned.add(name);
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
  record[state].executor = executor;
  // A column absent from the row wasn't selected: the attribute stays unloaded.
  applyRow(record, row);
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
        `${model.name} declares an attribute "${name}", which is the name of a record method; ` +
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
  record[state].executor = executor;
  for (const [name, definition] of model.attributeDefinitions) {
    record[values][name] = null;
    if (definition.default !== undefined) {
      record[values][name] = definition.default();
      record[state].assigned.add(name);
    }
  }
  for (const [name, value] of Object.entries(attributes)) {
    attributeOf(model, name);
    record[values][name] = value;
    record[state].assigned.add(name);
  }
  return record;
}
