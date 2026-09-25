import type { AttributeType } from "./model.ts";

interface Converter {
  /** D1 value → JavaScript value. Never called with null. */
  read(value: unknown): unknown;
  /** JavaScript value → D1 value. Never called with null. */
  write(value: unknown): unknown;
}

const identity = (value: unknown) => value;

const converters: Record<AttributeType, Converter> = {
  string: { read: identity, write: identity },
  integer: { read: identity, write: identity },
  real: { read: identity, write: identity },
  boolean: { read: (value) => value === 1, write: (value) => (value ? 1 : 0) },
  datetime: {
    read: (value) => new Date(value as string),
    write: (value) => (value as Date).toISOString(),
  },
  json: { read: (value) => JSON.parse(value as string), write: (value) => JSON.stringify(value) },
};

export function readValue(type: AttributeType, value: unknown): unknown {
  return value === null || value === undefined ? null : converters[type].read(value);
}

export function writeValue(type: AttributeType, value: unknown): unknown {
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
