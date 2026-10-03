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

/**
 * Models whose table has columns they ignore (`Model("products", { notes: false })`): their
 * queries name their columns rather than `*`, so an ignored column is never read, as in Rails.
 */
const ignoringColumns = new WeakSet<object>();

/** Marks a Model's base class as ignoring some of its table's columns. */
export function ignoresColumns(base: object): void {
  ignoringColumns.add(base);
}

/** Whether a Model (or a class it extends) ignores some of its table's columns. */
export function listsColumns(model: object): boolean {
  for (
    let current: object | null = model;
    current !== null;
    current = Object.getPrototypeOf(current)
  ) {
    if (ignoringColumns.has(current)) return true;
  }
  return false;
}

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

/** The attribute names mapped to `column` (usually one; none if the column isn't declared). */
export function attributesForColumn(model: ModelClass, column: string): string[] {
  return [...model.attributeDefinitions]
    .filter(([, definition]) => definition.column === column)
    .map(([name]) => name);
}

/** `undefined` would silently store NULL, so writing it throws `TypeError` (use `null`). */
export function requireDefined(model: ModelClass, name: string, value: unknown): void {
  if (value === undefined) {
    throw new TypeError(`${model.name}: got undefined for "${name}"; use null to store NULL`);
  }
}

/** The Model's declared defaults, evaluated now, for every attribute not in `given`. */
export function evaluateDefaults(model: ModelClass, given: object = {}): [string, unknown][] {
  return [...model.attributeDefinitions]
    .filter(([name, definition]) => definition.default !== undefined && !(name in given))
    .map(([name, definition]) => [name, definition.default!()]);
}
