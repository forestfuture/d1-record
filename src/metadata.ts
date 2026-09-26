import { UnknownAttribute } from "./errors.ts";
import type { ModelClass } from "./model.ts";
import { underscore } from "./naming.ts";

export type AttributeType = "string" | "integer" | "real" | "boolean" | "datetime" | "json";

export type AttributeSpec =
  | AttributeType
  | {
      type: AttributeType;
      null?: boolean;
      column?: string;
      /** Evaluated at `build()`, e.g. `() => crypto.randomUUID()` for app-generated keys. */
      default?: () => unknown;
    };

export type AttributeSpecs = Record<string, AttributeSpec>;

/** An attribute's resolved metadata. */
export interface AttributeDefinition {
  type: AttributeType;
  column: string;
  default?: () => unknown;
}

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

/** Resolves an attribute's spec into its type, column and default. */
export function define(name: string, spec: AttributeSpec): AttributeDefinition {
  return typeof spec === "string"
    ? { type: spec, column: underscore(name) }
    : { type: spec.type, column: spec.column ?? underscore(name), default: spec.default };
}

/** Looks up a declared attribute; throws `UnknownAttribute` for any other name. */
export function attributeOf(model: ModelClass, name: string): AttributeDefinition {
  const attribute = model.attributeDefinitions.get(name);
  if (attribute === undefined) {
    throw new UnknownAttribute(`${model.name} has no attribute "${name}"`);
  }
  return attribute;
}
