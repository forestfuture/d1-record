import type { AttributeType } from "./model.ts";

interface Converter {
  /** D1 value → JavaScript value. Never called with null. */
  read(value: unknown): unknown;
}

const identity = (value: unknown) => value;

const converters: Record<AttributeType, Converter> = {
  string: { read: identity },
  integer: { read: identity },
  real: { read: identity },
  boolean: { read: (value) => value === 1 },
  datetime: { read: (value) => new Date(value as string) },
  json: { read: (value) => JSON.parse(value as string) },
};

export function readValue(type: AttributeType, value: unknown): unknown {
  return value === null || value === undefined ? null : converters[type].read(value);
}
