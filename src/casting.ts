import { attributeOf, type AttributeType } from "./metadata.ts";
import type { ModelClass } from "./model.ts";

/** A value that can't be read as the attribute's type. */
export const uncastable = Symbol("uncastable");

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

/**
 * A decimal number, with an optional exponent (`1.5`, `-2e3`, `.5`), and spaces around it.
 * Digits after the point only follow a point, so no run of digits can match two ways: an
 * optional point between two runs of digits backtracks quadratically on a long string (ReDoS).
 */
const realText = /^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?\s*$/i;

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
  if (isoDate.test(value)) return dayOf(value) ?? uncastable;
  // The day must exist too: `Date` rolls 2026-02-30T10:00Z over to 2 March.
  if (!isoDateTime.test(value) || dayOf(value.slice(0, 10)) === undefined) return uncastable;
  const date = new Date(value.replace(" ", "T"));
  return isInvalidDate(date) ? uncastable : date;
}

/** Midnight UTC on `day` (`2026-01-02`), if that day exists. */
function dayOf(day: string): Date | undefined {
  const date = new Date(`${day}T00:00:00.000Z`);
  return !isInvalidDate(date) && date.toISOString().startsWith(day) ? date : undefined;
}

function isInvalidDate(value: unknown): boolean {
  return value instanceof Date && Number.isNaN(value.getTime());
}

/** How much of a value an error shows: it came from outside, and errors are often logged. */
const SHOWN_LENGTH = 60;

/**
 * A value as it's shown in an error: JSON where it has one, numbers as written, and at most
 * `SHOWN_LENGTH` characters of it.
 */
function shown(value: unknown): string {
  const text = textOf(value);
  return text.length > SHOWN_LENGTH ? `${text.slice(0, SHOWN_LENGTH)}…` : text;
}

function textOf(value: unknown): string {
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

/**
 * A condition's value as the attribute's type, or `uncastable`: a condition with one matches
 * nothing (as in Rails 6.1+), so a value from a URL is never an error or a NULL match.
 */
export function castCondition(type: AttributeType, value: unknown): unknown {
  return value === null ? null : casts[type](value);
}
