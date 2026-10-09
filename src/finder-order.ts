// The order and limit a finder (`first`, `last`, `take`) applies to a Relation's query.
import { IrreversibleOrder } from "./errors.ts";
import type { OrderTerm } from "./query.ts";
import { SafeSql } from "./sql.ts";

/** The same term sorting the other way; NULLs move to the other end too, as in Rails. */
export function reversed(term: OrderTerm): OrderTerm {
  if (term instanceof SafeSql) {
    throw new IrreversibleOrder(
      "last() can't reverse an order given as an sql fragment; order by attributes, or reverse the fragment yourself and use first()",
    );
  }
  const direction = term.direction === "asc" ? "desc" : "asc";
  const nulls = term.nulls && (term.nulls === "first" ? "last" : "first");
  return { ...term, direction, ...(nulls && { nulls }) };
}

/** One record from the page: `limit(0)` stays empty, and `offset` is kept by the caller. */
export function atMostOne(limit: number | undefined): number {
  return Math.min(limit ?? 1, 1);
}
