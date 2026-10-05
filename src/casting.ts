import { attributeOf, type AttributeType } from "./metadata.ts";
import type { ModelClass } from "./model.ts";

/** A value that can't be read as the attribute's type. */
const uncastable = Symbol("uncastable");

/**
 * Each type's cast: the value as that type, or `uncastable`. Only what's unambiguous is
 * accepted, so a value from JSON, a form or a query string can't be read as something it
 * isn't (#81). Never called with null.
 */
const casts: Record<AttributeType, (value: unknown) => unknown> = {
  string: (value) => (typeof value === "string" ? value : uncastable),
  integer: castInteger,
  real: castReal,
  boolean: castBoolean,
  datetime: castDatetime,
  json: (value) => value,
};

const booleans = new Map<unknown, boolean>([
  [true, true],
  [false, false],
  [1, true],
  [0, false],
  ["1", true],
  ["0", false],
  ["true", true],
  ["false", false],
  ["on", true],
  ["off", false],
]);

/** `true`/`false`, `1`/`0`, `"1"`/`"0"`, and `"true"`/`"false"` or `"on"`/`"off"` in any case. */
function castBoolean(value: unknown): unknown {
  const key = typeof value === "string" ? value.toLowerCase() : value;
  return booleans.has(key) ? booleans.get(key) : uncastable;
}

/** A whole number, signed, with nothing else but spaces around it. */
const integerText = /^\s*[+-]?\d+\s*$/;

/** A decimal number, with an optional exponent (`1.5`, `-2e3`, `.5`), and spaces around it. */
const realText = /^\s*[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?\s*$/i;

/** A number read from `text` when it matches `pattern`, else `uncastable`. */
function numberFrom(value: unknown, pattern: RegExp): unknown {
  if (typeof value === "number") return value;
  return typeof value === "string" && pattern.test(value) ? Number(value) : uncastable;
}

/** A safe integer, or a string that's wholly one: `1.7`, `"12abc"` and `"1e3"` aren't. */
function castInteger(value: unknown): unknown {
  const number = numberFrom(value, integerText);
  return Number.isSafeInteger(number) ? number : uncastable;
}

/** A finite number, or a string that's wholly a decimal number. */
function castReal(value: unknown): unknown {
  const number = numberFrom(value, realText);
  return Number.isFinite(number) ? number : uncastable;
}

/** An ISO-8601 date: `2026-01-02`, read as midnight UTC. */
const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/;

/** An ISO-8601 date and time, with `Z` or an offset: a time without one is ambiguous. */
const isoDateTime =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** A valid `Date`, or an ISO-8601 string (a date, or a date and time with its offset). */
function castDatetime(value: unknown): unknown {
  if (value instanceof Date) return isInvalidDate(value) ? uncastable : value;
  if (typeof value !== "string") return uncastable;
  if (isoDate.test(value)) {
    const date = new Date(`${value}T00:00:00.000Z`);
    // `Date` rolls 2026-02-30 over to March; a date that doesn't exist isn't one.
    return !isInvalidDate(date) && date.toISOString().startsWith(value) ? date : uncastable;
  }
  if (!isoDateTime.test(value)) return uncastable;
  const date = new Date(value.replace(" ", "T"));
  return isInvalidDate(date) ? uncastable : date;
}

function isInvalidDate(value: unknown): boolean {
  return value instanceof Date && Number.isNaN(value.getTime());
}

/** A value as it's shown in an error: JSON where it has one, and numbers as written. */
function shown(value: unknown): string {
  if (typeof value === "number" || isInvalidDate(value)) return String(value);
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * `value` as the attribute's type, for assigning: what records, `insert` and `updateAll`
 * store. A value that can't be cast throws `TypeError` naming the Model and attribute.
 */
export function castAssigned(
  model: string,
  attribute: string,
  type: AttributeType,
  value: unknown,
): unknown {
  if (value === null) return null;
  const cast = casts[type](value);
  if (cast === uncastable) {
    const article = /^[aeiou]/.test(type) ? "an" : "a";
    throw new TypeError(`${model}: ${shown(value)} isn't ${article} ${type} for "${attribute}"`);
  }
  return cast;
}

/** Attribute values given to a bulk write (`insert`, `updateAll`, …), each cast as it's assigned. */
export function castGiven(
  model: ModelClass,
  entries: readonly (readonly [string, unknown])[],
): [string, unknown][] {
  return entries.map(([name, value]) => [
    name,
    castAssigned(model.name, name, attributeOf(model, name).type, value),
  ]);
}
