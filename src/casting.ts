import { castCondition, castValue, isInvalidDate, uncastable } from "./conversion.ts";
import { FILTERED, isFiltered } from "./filtering.ts";
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
 * store (#81). A value that can't be cast throws `TypeError` naming the Model and attribute,
 * and showing the value unless the attribute is filtered (#83).
 */
export function castAssigned(model: ModelClass, attribute: string, value: unknown): unknown {
  const { type } = attributeOf(model, attribute);
  const cast = castValue(type, value);
  if (cast === uncastable) throw uncastableError(model, attribute, value);
  return cast;
}

/**
 * `value` cast to `attribute`'s type as a condition's is (#94): for a key copied from another
 * record (an association's foreign key), or a value a record inherits from a condition, so a
 * number becomes its digits for a string attribute. One that still can't be cast throws
 * `TypeError`, naming the association it came through, if any.
 */
export function castKey(
  model: ModelClass,
  attribute: string,
  value: unknown,
  association?: string,
): unknown {
  const { type } = attributeOf(model, attribute);
  const cast = castCondition(type, value);
  if (cast === uncastable) throw uncastableError(model, attribute, value, association);
  return cast;
}

/** The values a record built from a Relation inherits from its conditions, cast as keys are. */
export function castInherited(
  model: ModelClass,
  inherited: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(inherited).map(([name, value]) => [name, castKey(model, name, value)]),
  );
}

/** "Sample: "no" isn't a boolean for "enabled"", the value hidden for a filtered attribute. */
function uncastableError(
  model: ModelClass,
  attribute: string,
  value: unknown,
  association?: string,
): TypeError {
  const { type } = attributeOf(model, attribute);
  const article = /^[aeiou]/.test(type) ? "an" : "a";
  const text = isFiltered(model, attribute) ? FILTERED : shown(value);
  const from = association === undefined ? "" : `, the key of ${association}`;
  return new TypeError(`${model.name}: ${text} isn't ${article} ${type} for "${attribute}"${from}`);
}

/** Attribute values given to a bulk write (`insert`, `updateAll`, …), each cast as it's assigned. */
export function castGiven(
  model: ModelClass,
  entries: readonly (readonly [string, unknown])[],
): [string, unknown][] {
  return entries.map(([name, value]) => [name, castAssigned(model, name, value)]);
}
