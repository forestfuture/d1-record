import type { ModelClass } from "./model.ts";
import { underscore } from "./naming.ts";

/** What a listener sees in place of a filtered attribute's value (#83). */
export const FILTERED = "[FILTERED]";

/**
 * Rails' default `filter_parameters` for a new app: an attribute whose snake_case name holds
 * one of these, in any case, is filtered (`passwordDigest`, `apiKey`, `resetToken`, `email`).
 */
export const defaultFilterAttributes: readonly (string | RegExp)[] = [
  "passw",
  "email",
  "secret",
  "token",
  "_key",
  "crypt",
  "salt",
  "certificate",
  "otp",
  "ssn",
  "cvv",
  "cvc",
];

/**
 * Whether `attribute`'s values are hidden from listeners: its snake_case name holds a string
 * entry (in any case), or a RegExp entry matches the attribute or its snake_case name.
 */
export function isFiltered(model: ModelClass, attribute: string): boolean {
  const name = underscore(attribute).toLowerCase();
  return model.filterAttributes.some((entry) =>
    typeof entry === "string"
      ? name.includes(entry.toLowerCase())
      : attribute.search(entry) !== -1 || name.search(entry) !== -1,
  );
}

/** A bound value D1 gets as `value`, and listeners see as `shown`. */
export class Filtered {
  readonly value: unknown;
  readonly shown: unknown;

  constructor(value: unknown, shown: unknown = FILTERED) {
    this.value = value;
    this.shown = shown;
  }
}

/** Binds values as one attribute's: hidden from listeners when the attribute is filtered. */
export type Bind = (...values: unknown[]) => void;

/** A `Bind` that appends to `params` as `attribute`'s values. */
export function binderFor(params: unknown[], model: ModelClass, attribute: string): Bind {
  const filtered = isFiltered(model, attribute);
  return (...values) => {
    for (const value of values) params.push(filtered ? new Filtered(value) : value);
  };
}

/** The value D1 binds. */
export function boundValue(param: unknown): unknown {
  return param instanceof Filtered ? param.value : param;
}

/** The value listeners see. */
export function shownValue(param: unknown): unknown {
  return param instanceof Filtered ? param.shown : param;
}
