// An attribute value's whole path (#94): cast, refused, stored, and bound in one place.
// Cast by how it reaches the attribute (its use), refused with an error that names it, put in
// the form D1 stores, and bound hidden from listeners when the attribute is filtered. Records,
// Relations, associations, preloads, and the compiler all go through here, so no caller has to
// cast or bind a value its own way.
import {
  castCondition,
  castValue,
  convertsAs,
  isInvalidDate,
  uncastable,
  writeValue,
} from "./conversion.ts";
import { FILTERED, Filtered, isFiltered } from "./filtering.ts";
import { attributeOf } from "./metadata.ts";
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
  const converter = convertsAs(definition);
  const cast = use === "assigned" ? castValue(converter, value) : castCondition(converter, value);
  if (cast === uncastable && use !== "condition") throw uncastableError(of, type, value);
  return cast;
}

/** `value` cast for `use`, in the form D1 stores; `uncastable` for a condition that can't be. */
export function storedAs(use: Use, of: ValueOf, value: unknown): unknown {
  const cast = castAs(use, of, value);
  if (cast === uncastable) return uncastable;
  return writeValue(convertsAs(attributeOf(of.model, of.attribute)), cast);
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

/** "Sample: "no" isn't a boolean for "enabled"", the value hidden for a filtered attribute. */
function uncastableError({ model, attribute, association }: ValueOf, type: string, value: unknown) {
  const article = /^[aeiou]/.test(type) ? "an" : "a";
  const text = isFiltered(model, attribute) ? FILTERED : shown(value);
  const from = association === undefined ? "" : `, the key of ${association}`;
  return new TypeError(`${model.name}: ${text} isn't ${article} ${type} for "${attribute}"${from}`);
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
