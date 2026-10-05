import { attributeOf } from "./metadata.ts";
import type { ModelClass } from "./model.ts";

/**
 * The named attributes of untrusted `input`, as Rails' `params.permit`: every other key is
 * dropped, so it never reaches a record (#82). Values are left as they are: they're cast (or
 * refused) when they're assigned (#81).
 */
export function permitted(
  model: ModelClass,
  input: unknown,
  names: readonly string[],
): Record<string, unknown> {
  for (const name of names) attributeOf(model, name);
  const given = givenValues(model, input);
  return Object.fromEntries(
    names.filter((name) => given.has(name)).map((name) => [name, given.get(name)]),
  );
}

/**
 * Each key of `input` and its value: an object's own keys only, so `__proto__` and inherited
 * keys never count, or a form's or query string's, where a repeated key takes its last value.
 */
function givenValues(model: ModelClass, input: unknown): Map<string, unknown> {
  if (input instanceof FormData || input instanceof URLSearchParams) {
    return new Map<string, unknown>(input);
  }
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError(`${model.name}.permit() takes an object, FormData or URLSearchParams`);
  }
  return new Map(Object.entries(input));
}
