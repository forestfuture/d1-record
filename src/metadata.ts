// Attribute metadata: each attribute's type, column and default, resolved from its spec.
import { ancestors } from "./ancestors.ts";
import { UnknownAttribute } from "./errors.ts";
import type { ModelClass } from "./model.ts";
import { underscore } from "./naming.ts";

export type AttributeType = "string" | "integer" | "real" | "boolean" | "datetime" | "json";

/** How a `datetime` is stored when it's an integer rather than ISO text: seconds or milliseconds (#73). */
export type EpochStorage = "unixSeconds" | "unixMilliseconds";

/** An attribute's spec written out: its type, and optionally nullability, column and default. */
export interface SpecObject {
  type: AttributeType;
  null?: boolean;
  column?: string;
  /** A `datetime` held as a Unix epoch integer, as Drizzle's timestamp modes write it (#73). */
  storage?: EpochStorage;
  /** Evaluated at `build()`, e.g. `() => new Date()`. */
  default?: () => unknown;
  /**
   * Made by the Model's `generateId` when not given, where a default would run: an
   * app-generated key (#99). Generated ids are strings, so only a string attribute has one.
   */
  generateId?: boolean;
}

/** Where a string attribute's value comes from when it isn't given: a default or `generateId`, never both. */
export type ValueSource =
  | { default?: () => unknown; generateId?: false }
  | { default?: never; generateId: true };

export type AttributeSpec =
  | AttributeType
  | (Omit<SpecObject, "default" | "generateId" | "storage"> & {
      type: "string";
      storage?: never;
    } & ValueSource)
  | (Omit<SpecObject, "type" | "generateId" | "storage"> & {
      type: Exclude<AttributeType, "string" | "datetime">;
      generateId?: false;
      storage?: never;
    })
  | (Omit<SpecObject, "type" | "generateId"> & { type: "datetime"; generateId?: false });

export type AttributeSpecs = Record<string, AttributeSpec>;

/**
 * `A`, with any key a spec doesn't have typed `never`, so a misspelled one (`nul: false`) is a
 * compile error: a generic parameter skips TypeScript's own check for unknown keys (#102).
 */
export type ExactSpecs<A> = {
  [K in keyof A]: A[K] extends object
    ? A[K] & Record<Exclude<keyof A[K], keyof SpecObject>, never>
    : A[K];
};

/** An attribute's resolved metadata. */
export interface AttributeDefinition {
  type: AttributeType;
  column: string;
  default?: () => unknown;
  generateId?: true;
  storage?: EpochStorage;
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
export function markIgnoringColumns(base: object): void {
  // The answer is remembered once asked, so a mark after that would silently not apply.
  if (ignoring.has(base)) throw new Error("d1-record: a Model was marked after its first use");
  ignoringColumns.add(base);
}

/**
 * Each Model's answer to `ignoresColumns`, worked out once when it's made ready. Module-level,
 * but not request state (ADR-0003): derived only from the class.
 */
const ignoring = new WeakMap<object, boolean>();

/**
 * Whether a Model (or a class it extends) ignores some of its table's columns. Remembered per
 * Model: the mark is set when `ApplicationRecord("table", overrides)` makes the base class,
 * before any Model extending it exists, so it can't change once asked.
 */
export function ignoresColumns(model: object): boolean {
  let answer = ignoring.get(model);
  if (answer === undefined) {
    answer = ancestors(model).some((each) => ignoringColumns.has(each));
    ignoring.set(model, answer);
  }
  return answer;
}

/** Resolves an attribute's spec into its type, column and default. */
export function define(name: string, spec: AttributeSpec): AttributeDefinition {
  return typeof spec === "string"
    ? { type: spec, column: underscore(name) }
    : {
        type: spec.type,
        column: spec.column ?? underscore(name),
        default: spec.default,
        ...(spec.generateId === true && { generateId: true as const }),
        ...(spec.storage !== undefined && { storage: spec.storage }),
      };
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

/**
 * Why an attribute can't have `generateId`, or undefined if it can: a generated id is a string,
 * and comes from `generateId` alone, not a default as well (#99). `where` names it (`User.id`).
 */
export function generateIdProblem(
  where: string,
  { type, default: initial, generateId }: Pick<SpecObject, "type" | "default" | "generateId">,
): string | undefined {
  if (generateId !== true) return undefined;
  if (initial !== undefined) {
    return `${where} has both generateId and a default; keep one`;
  }
  if (type !== "string") {
    return `${where} is "${type}", so it can't have generateId: generated ids are strings`;
  }
  return undefined;
}

/**
 * Why an attribute can't have this `storage`, or undefined if it can: only a datetime is stored
 * as a Unix epoch, in seconds or milliseconds (#73). `where` names it (`Event.at`).
 */
export function storageProblem(
  where: string,
  { type, storage }: Pick<SpecObject, "type" | "storage">,
): string | undefined {
  if (storage === undefined) return undefined;
  if (storage !== "unixSeconds" && storage !== "unixMilliseconds") {
    return `${where} has storage ${JSON.stringify(storage)}; use "unixSeconds" or "unixMilliseconds"`;
  }
  if (type !== "datetime") {
    return `${where} is "${type}", so it can't have a storage: only a datetime is stored as an epoch`;
  }
  return undefined;
}

/** `undefined` would silently store NULL, so writing it throws `TypeError` (use `null`). */
export function requireDefined(model: ModelClass, name: string, value: unknown): void {
  if (value === undefined) {
    throw new TypeError(`${model.name}: got undefined for "${name}"; use null to store NULL`);
  }
}

/**
 * The initial values of every attribute not in `given` that has one, made now: each one's
 * `default`, or for a generated id, the Model's `generateId(name)`.
 */
export function initialValues(model: ModelClass, given: object = {}): [string, unknown][] {
  return [...model.attributeDefinitions]
    .filter(([name, definition]) => !(name in given) && hasInitialValue(definition))
    .map(([name, definition]) => [
      name,
      definition.generateId ? model.generateId(name) : definition.default!(),
    ]);
}

/** Whether an attribute gets a value when none is given: from its `default`, or `generateId`. */
function hasInitialValue(definition: AttributeDefinition): boolean {
  return definition.generateId === true || definition.default !== undefined;
}
