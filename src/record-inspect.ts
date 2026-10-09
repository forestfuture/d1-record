// How a record prints in a console, a log or a test failure: its class and attributes (#104).

/** What Node's `util.inspect` passes a custom inspector; `src/` doesn't import Node's types. */
export interface InspectOptions {
  depth?: number | null;
}
export type Inspect = (value: unknown, options?: InspectOptions) => string;

/** Node and workerd call a value's inspector under this registered symbol. */
export const inspectCustom = Symbol.for("nodejs.util.inspect.custom");

/** `Name { attribute: value, … }`, its values printed by the runtime's own `inspect`. */
export function inspectRecord(
  name: string,
  attributes: Record<string, unknown>,
  options: InspectOptions,
  inspect: Inspect,
): string {
  const depth = options.depth == null ? options.depth : options.depth - 1;
  return `${name} ${inspect(attributes, { ...options, depth })}`;
}
