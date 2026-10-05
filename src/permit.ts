import { attributeOf } from "./metadata.ts";
import type { ModelClass } from "./model.ts";

/**
 * The named attributes of untrusted `input`, as Rails' `params.permit`: every other key is
 * dropped, so it never reaches a record (#82). Only the input's own keys are read. Values are
 * left as they are: they're cast (or refused) when they're assigned (#81).
 */
export function permitted(
  model: ModelClass,
  input: unknown,
  names: readonly string[],
): Record<string, unknown> {
  for (const name of names) attributeOf(model, name);
  const entries = input as Record<string, unknown>;
  return Object.fromEntries(
    names.filter((name) => Object.hasOwn(entries, name)).map((name) => [name, entries[name]]),
  );
}
