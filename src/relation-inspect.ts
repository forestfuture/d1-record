// How a Relation prints: its Model and the SELECT it would send, which printing never sends (#104).
import type { CompiledSql } from "./compiler.ts";
import { Filtered } from "./filtering.ts";
import { Redacted, styled, type Inspect, type InspectOptions } from "./record-inspect.ts";

/** `Relation<Model> { sql, params }`, filtered params as `[FILTERED]`; `[Relation]` past `depth`. */
export function inspectRelation(
  modelName: string,
  { sql, params }: CompiledSql,
  [depth, options, inspect]: [number, InspectOptions, Inspect],
): string {
  if (depth < 0) return styled(options, "[Relation]");
  const shown = params.map((param) => (param instanceof Filtered ? new Redacted(false) : param));
  const innerDepth = options.depth == null ? options.depth : options.depth - 1;
  return `Relation<${modelName}> ${inspect({ sql, params: shown }, { ...options, depth: innerDepth })}`;
}
