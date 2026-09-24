import { readValue } from "./types.ts";

export type AttributeType = "string" | "integer" | "real" | "boolean" | "datetime" | "json";

export type AttributeSpec = AttributeType | { type: AttributeType; null?: boolean };

export type AttributeSpecs = Record<string, AttributeSpec>;

type JsType<T extends AttributeType> = T extends "string"
  ? string
  : T extends "integer" | "real"
    ? number
    : T extends "boolean"
      ? boolean
      : T extends "datetime"
        ? Date
        : unknown;

type AttributeValue<S> = S extends AttributeType
  ? JsType<S> | null
  : S extends { type: infer T extends AttributeType; null: false }
    ? JsType<T>
    : S extends { type: infer T extends AttributeType }
      ? JsType<T> | null
      : never;

export type AttributeProperties<A extends AttributeSpecs> = {
  -readonly [K in keyof A]: AttributeValue<A[K]>;
};

const values = Symbol("values");

function typeOf(spec: AttributeSpec): AttributeType {
  return typeof spec === "string" ? spec : spec.type;
}

export class ModelBase {
  static tableName: string;
  static attributeSpecs: AttributeSpecs = {};

  [values]: Record<string, unknown> = {};
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
): (new () => ModelBase & AttributeProperties<A>) & Omit<typeof ModelBase, "prototype"> {
  class DefinedModel extends ModelBase {
    static override attributeSpecs: AttributeSpecs = { ...specs };
  }
  for (const name of Object.keys(specs)) {
    Object.defineProperty(DefinedModel.prototype, name, {
      get(this: ModelBase) {
        return this[values][name];
      },
      set(this: ModelBase, value: unknown) {
        this[values][name] = value;
      },
    });
  }
  return DefinedModel as never;
}

/** Builds a persisted record of `model` from a D1 row. */
export function hydrate<M extends ModelBase>(
  model: ModelClass<M>,
  row: Record<string, unknown>,
): M {
  const record = new model();
  for (const [name, spec] of Object.entries(model.attributeSpecs)) {
    record[values][name] = readValue(typeOf(spec), row[name]);
  }
  return record;
}
