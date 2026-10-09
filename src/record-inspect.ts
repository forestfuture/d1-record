// How a record prints in a console, a log or a test failure: its class and attributes (#104).
import { FILTERED, isFiltered } from "./filtering.ts";
import type { ModelClass } from "./model.ts";

/** What Node's `util.inspect` passes a custom inspector; `src/` doesn't import Node's types. */
export interface InspectOptions {
  depth?: number | null;
  /** Wraps text in the color for a kind of value, or returns it as is when colors are off. */
  stylize?: (text: string, style: "special") => string;
}
export type Inspect = (value: unknown, options?: InspectOptions) => string;

/** Node and workerd call a value's inspector under this registered symbol. */
export const inspectCustom = Symbol.for("nodejs.util.inspect.custom");

/** A filtered value's stand-in: prints unquoted, so it isn't taken for a string, as a special value. */
class Redacted {
  [inspectCustom](_depth: number, options: InspectOptions): string {
    return options.stylize ? options.stylize(FILTERED, "special") : FILTERED;
  }
}

/** `Name { attribute: value, … }`, its values printed by the runtime's own `inspect`. */
export function inspectRecord(
  model: ModelClass,
  attributes: Record<string, unknown>,
  options: InspectOptions,
  inspect: Inspect,
): string {
  const depth = options.depth == null ? options.depth : options.depth - 1;
  const shown = Object.fromEntries(
    Object.entries(attributes).map(([name, value]) => [
      name,
      value !== null && isFiltered(model, name) ? new Redacted() : value,
    ]),
  );
  return `${model.name} ${inspect(shown, { ...options, depth })}`;
}
