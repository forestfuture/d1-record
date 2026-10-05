import { castValue, isInvalidDate, uncastable } from "./conversion.ts";
import { attributeOf } from "./metadata.ts";
import type { ModelClass } from "./model.ts";

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
 * `value` cast to `attribute`'s type, for assigning: what records, `insert` and `updateAll`
 * store (#81). A value that can't be cast throws `TypeError` naming the Model and attribute.
 */
export function castAssigned(model: ModelClass, attribute: string, value: unknown): unknown {
  const { type } = attributeOf(model, attribute);
  const cast = castValue(type, value);
  if (cast === uncastable) {
    const article = /^[aeiou]/.test(type) ? "an" : "a";
    throw new TypeError(
      `${model.name}: ${shown(value)} isn't ${article} ${type} for "${attribute}"`,
    );
  }
  return cast;
}

/** Attribute values given to a bulk write (`insert`, `updateAll`, …), each cast as it's assigned. */
export function castGiven(
  model: ModelClass,
  entries: readonly (readonly [string, unknown])[],
): [string, unknown][] {
  return entries.map(([name, value]) => [name, castAssigned(model, name, value)]);
}
