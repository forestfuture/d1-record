// How a record prints in a console, a log or a test failure: its class and attributes (#104).
import { FILTERED, isFiltered } from "./filtering.ts";
import type { ModelClass } from "./model.ts";
import type { Changes } from "./record-state.ts";

/** What Node's `util.inspect` passes a custom inspector; `src/` doesn't import Node's types. */
export interface InspectOptions {
  depth?: number | null;
  /** Wraps text in the color for a kind of value, or returns it as is when colors are off. */
  stylize?: (text: string, style: "special") => string;
}
export type Inspect = (value: unknown, options?: InspectOptions) => string;

/** Node and workerd call a value's inspector under this registered symbol. */
export const inspectCustom = Symbol.for("nodejs.util.inspect.custom");

/** Text in the color of a special value, or plain when colors are off. */
export function styled(options: InspectOptions, text: string): string {
  return options.stylize ? options.stylize(text, "special") : text;
}

/** A filtered value's stand-in: prints unquoted, so it isn't taken for a string, as a special value. */
export class Redacted {
  constructor(private readonly changed: boolean) {}

  [inspectCustom](_depth: number, options: InspectOptions): string {
    return styled(options, FILTERED) + (this.changed ? " (changed)" : "");
  }
}

/** An unsaved change: the new value, and the one the record was loaded or saved with, if any. */
class Unsaved {
  constructor(
    private readonly after: unknown,
    private readonly before: unknown,
  ) {}

  [inspectCustom](_depth: number, options: InspectOptions, inspect: Inspect): string {
    const now = inspect(this.after, options);
    return this.before === undefined
      ? `${now} (changed)`
      : `${now} (was ${inspect(this.before, options)})`;
  }
}

/** `Name { attribute: value, … }`, its values printed by the runtime's own `inspect`. */
export function inspectRecord(
  model: ModelClass,
  attributes: Record<string, unknown>,
  changes: Changes,
  [depth, options, inspect]: [number, InspectOptions, Inspect],
): string {
  // Nested deeper than `depth` allows: just the name, as Node prints any class instance.
  if (depth < 0) return styled(options, `[${model.name}]`);
  const shown = Object.fromEntries(
    Object.entries(attributes).map(([name, value]) => {
      const change = changes[name];
      // A null has nothing to hide, but becoming null is a change worth flagging.
      if (isFiltered(model, name) && (value !== null || change)) {
        return [name, new Redacted(!!change)];
      }
      return [name, change ? new Unsaved(value, change[0]) : value];
    }),
  );
  return `${model.name} ${inspect(shown, { ...options, depth })}`;
}
