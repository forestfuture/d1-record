// An attribute value's whole path (#94): cast, refused, stored, and bound in one place.
// Cast by how it reaches the attribute (its use), refused with an error that names it, put in
// the form D1 stores, and bound hidden from listeners when the attribute is filtered. Records,
// Relations, associations, preloads, and the compiler all go through here, so no caller has to
// cast or bind a value its own way.
import {
  castCondition,
  castValue,
  isInvalidDate,
  readValue,
  uncastable,
  writeValue,
} from "./conversion.ts";
import { FILTERED, Filtered, isFiltered } from "./filtering.ts";
import { type AttributeType, attributeOf } from "./metadata.ts";
import type { ModelClass } from "./model.ts";

export { uncastable };

/**
 * How a value reaches an attribute:
 * - `assigned`: given by code or a request (a setter, `build`, `update`, `insert`, `permit`):
 *   only what's unambiguous for the type (#81).
 * - `condition`: matched in `where`, `find` or a preload: a number also matches a string
 *   attribute as its digits, and a value that can't be cast matches nothing.
 * - `key`: copied from another record or inherited from a condition: cast as a condition's,
 *   but one that can't be cast throws.
 */
export type Use = "assigned" | "condition" | "key";

/** The attribute a value is for, and the association it came through, if any. */
export interface ValueOf {
  model: ModelClass;
  attribute: string;
  association?: string | undefined;
}

/**
 * `value` as the attribute's type for `use`. An `assigned` or `key` value that can't be cast
 * throws `TypeError` naming the Model, attribute and association, and showing the value unless
 * the attribute is filtered (#83); a `condition` value returns `uncastable`.
 */
export function castAs(use: Use, of: ValueOf, value: unknown): unknown {
  const definition = attributeOf(of.model, of.attribute);
  const { type } = definition;
  const cast = use === "assigned" ? castValue(definition, value) : castCondition(definition, value);
  if (cast === uncastable && use !== "condition") throw uncastableError(of, type, value);
  return cast;
}

/** `value` cast for `use`, in the form D1 stores; `uncastable` for a condition that can't be. */
export function storedAs(use: Use, of: ValueOf, value: unknown): unknown {
  const cast = castAs(use, of, value);
  return cast === uncastable ? uncastable : writeAs(of, cast);
}

/**
 * An attribute's value in the form D1 stores. For a value already cast, which a json one can
 * stop being: mutated in place since, it may be one JSON can't write now, and that throws
 * `TypeError` naming the attribute, as assigning it would (#146).
 */
export function writeAs(of: ValueOf, value: unknown): unknown {
  const definition = attributeOf(of.model, of.attribute);
  let stored: unknown;
  try {
    stored = writeValue(definition, value);
  } catch (error) {
    if (definition.type !== "json") throw error;
    throw uncastableError(of, definition.type, value);
  }
  // Only a json value gives nothing: JSON writes no function or symbol.
  if (stored === undefined) throw uncastableError(of, definition.type, value);
  return stored;
}

/**
 * A cell D1 returned as the attribute's value. One that isn't (text in a Unix time column, or
 * past the range of a `Date`; a json cell that isn't JSON) throws `TypeError` naming the
 * attribute, with the cell hidden if it's filtered, not the parser's own error (#73, #146).
 */
export function readAs(of: ValueOf, stored: unknown): unknown {
  const definition = attributeOf(of.model, of.attribute);
  const value = readValue(definition, stored);
  if (value === uncastable) throw uncastableError(of, definition.type, stored);
  return value;
}

/** A copy of an attribute's value: written as D1 stores it, then read back. */
export function copyAs(of: ValueOf, value: unknown): unknown {
  return readAs(of, writeAs(of, value));
}

/** `value` cast as an assigned one, in the form D1 stores, bound and hidden if filtered (#83). */
export function bindAssigned(params: unknown[], of: ValueOf, value: unknown): void {
  bindAs(params, of, storedAs("assigned", of, value));
}

/**
 * Binds `stored` values (as D1 holds them) as the attribute's, each hidden from `onQuery`
 * listeners when the attribute is filtered (#83); D1 still gets the real values.
 */
export function bindAs(params: unknown[], of: ValueOf, ...stored: unknown[]): void {
  const filtered = isFiltered(of.model, of.attribute);
  for (const value of stored) params.push(filtered ? new Filtered(value) : value);
}

/**
 * Rows of `names`' values, assigned, as one JSON value D1 reads with `json_each`; listeners see
 * a filtered attribute's column as "[FILTERED]" in every row.
 */
export function storedRows(
  model: ModelClass,
  names: readonly string[],
  rows: readonly (readonly unknown[])[],
): unknown {
  const stored = rows.map((row) =>
    row.map((value, index) => storedAs("assigned", { model, attribute: names[index]! }, value)),
  );
  const json = JSON.stringify(stored);
  const filtered = names.map((attribute) => isFiltered(model, attribute));
  if (!filtered.includes(true)) return json;
  const shown = stored.map((row) =>
    row.map((value, index) => (filtered[index] ? FILTERED : value)),
  );
  return new Filtered(json, JSON.stringify(shown));
}

/**
 * The values a record built from a Relation inherits from its conditions, cast as keys are: a
 * hasMany's foreign key names its association (`link`) when it can't be cast.
 */
export function castInherited(
  model: ModelClass,
  inherited: Record<string, unknown>,
  link?: { attribute: string; association: string },
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(inherited).map(([attribute, value]) => {
      const association = attribute === link?.attribute ? link.association : undefined;
      return [attribute, castAs("key", { model, attribute, association }, value)];
    }),
  );
}

/** How much of a value an error shows: it came from outside, and errors are often logged. */
const SHOWN_LENGTH = 60;

/** What an attribute type is called in a refusal, where its name isn't it. */
const nouns: Partial<Record<AttributeType, string>> = { json: "JSON value" };

/**
 * "Sample: "no" isn't a boolean for "enabled"", the value hidden for a filtered attribute. Also
 * what a stored value that can't be read says: a Unix time that isn't one (#73), or a json cell
 * that isn't JSON (#146).
 */
function uncastableError(
  { model, attribute, association }: ValueOf,
  type: AttributeType,
  value: unknown,
) {
  const noun = nouns[type] ?? type;
  const article = /^[aeiou]/.test(noun) ? "an" : "a";
  const text = isFiltered(model, attribute) ? FILTERED : shown(value);
  const from = association === undefined ? "" : `, the key of ${association}`;
  return new TypeError(`${model.name}: ${text} isn't ${article} ${noun} for "${attribute}"${from}`);
}

/** A value as an error shows it: JSON where it has one, numbers as written, and at most 60 characters. */
function shown(value: unknown): string {
  const text = textOf(value);
  return text.length > SHOWN_LENGTH ? `${text.slice(0, SHOWN_LENGTH)}…` : text;
}

function textOf(value: unknown): string {
  if (typeof value === "number" || isInvalidDate(value)) return String(value);
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return plainText(value);
  }
}

/** `String(value)`, or its tag (`[object Array]`) when it has no string form: building the refusal mustn't throw. */
function plainText(value: unknown): string {
  try {
    return String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}
