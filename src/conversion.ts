// Converting values between attribute types and what D1 stores, per attribute type.
import type { AttributeDefinition, AttributeType, EpochStorage } from "./metadata.ts";

/** A value that can't be read as the attribute's type. */
export const uncastable = Symbol("uncastable");

interface Converter {
  /**
   * An assigned value or a condition's (#81) → the attribute's JavaScript value, or
   * `uncastable`. Only what's unambiguous is accepted, so a value from JSON, a form or a query
   * string can't be read as something it isn't. Never called with null.
   */
  cast(value: unknown): unknown;
  /** D1 value → JavaScript value. Never called with null. */
  read(value: unknown): unknown;
  /** JavaScript value → D1 value. Never called with null. */
  write(value: unknown): unknown;
}

const identity = (value: unknown) => value;

/** What converts an attribute's values: its type, or for a datetime stored as an epoch, that (#73). */
export type ConvertsAs = AttributeType | EpochStorage;

/** The converter for an attribute: its `storage` if it has one, else its type. */
export function convertsAs({ type, storage }: Pick<AttributeDefinition, "type" | "storage">) {
  return storage ?? type;
}

const converters: Record<ConvertsAs, Converter> = {
  string: {
    cast: (value) => (typeof value === "string" ? value : uncastable),
    read: identity,
    write: identity,
  },
  integer: { cast: castInteger, read: identity, write: identity },
  real: { cast: castReal, read: identity, write: identity },
  boolean: { cast: castBoolean, read: (value) => value === 1, write: (value) => (value ? 1 : 0) },
  datetime: {
    cast: castDatetime,
    read: readDatetime,
    write: (value) => (value as Date).toISOString(),
  },
  unixSeconds: {
    cast: castDatetime,
    read: (value) => new Date(Number(value) * 1000),
    write: (value) => Math.floor((value as Date).getTime() / 1000),
  },
  unixMilliseconds: {
    cast: castDatetime,
    read: (value) => new Date(Number(value)),
    write: (value) => (value as Date).getTime(),
  },
  json: {
    cast: identity,
    // Text is parsed. Under a column declared JSON, SQLite stores a number-like value (123) as
    // a number, and D1 returns it as one, which is already the value.
    read: (value) => (typeof value === "string" ? JSON.parse(value) : value),
    write: (value) => JSON.stringify(value),
  },
};

/** `value` as the attribute's type (null stays null), or `uncastable`. */
export function castValue(type: ConvertsAs, value: unknown): unknown {
  return value === null ? null : converters[type].cast(value);
}

/**
 * A condition's value as the attribute's type, or `uncastable`: as `castValue`, except that a
 * finite number matches a string attribute as its decimal string (`7` → `"7"`), as `find` does
 * for a text key and as Rails does, so a foreign key of another type still finds its target.
 */
export function castCondition(type: ConvertsAs, value: unknown): unknown {
  if (type === "string" && typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return castValue(type, value);
}

export function readValue(type: ConvertsAs, value: unknown): unknown {
  return value === null || value === undefined ? null : converters[type].read(value);
}

export function writeValue(type: ConvertsAs, value: unknown): unknown {
  return value === null || value === undefined ? null : converters[type].write(value);
}

/**
 * Converts a value with no declared attribute type (e.g. one interpolated into
 * an `sql` fragment) using the converter its runtime type implies, so it's
 * stored the same way as an attribute of that type.
 */
export function writeUntypedValue(value: unknown): unknown {
  if (value instanceof Date) return writeValue("datetime", value);
  if (typeof value === "boolean") return writeValue("boolean", value);
  return value;
}

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

/** `value` as a number: a number as it is, or a string matching `pattern`; else `uncastable`. */
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

/** A stored date and time with no zone, as SQLite's `CURRENT_TIMESTAMP` writes it: UTC (#73). */
const zonelessDateTime = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;

/**
 * A stored datetime as a `Date`. Text without a zone is UTC, as SQLite's own functions write
 * it, where `new Date` would read it in the process's time zone.
 */
function readDatetime(value: unknown): Date {
  if (typeof value !== "string") return new Date(value as number);
  return new Date(zonelessDateTime.test(value) ? `${value.replace(" ", "T")}Z` : value);
}

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

export function isInvalidDate(value: unknown): boolean {
  return value instanceof Date && Number.isNaN(value.getTime());
}
