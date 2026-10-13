// Refuses a bare date compared directly with an integer-stored attribute's column in a fragment (#149).
import { castValue, uncastable } from "./conversion.ts";
import { attributeOf } from "./metadata.ts";
import type { ModelClass } from "./model.ts";
import { ColumnReference, type SafeSql } from "./sql.ts";

/** A comparison operator, alone between two interpolations. */
const comparison = /^\s*(?:=|==|<>|!=|<=|>=|<|>)\s*$/;
/** `BETWEEN` (or `NOT BETWEEN`) alone before a bound, and `AND` alone between the two bounds. */
const betweenLower = /^\s*(?:NOT\s+)?BETWEEN\s*$/i;
const betweenUpper = /^\s*AND\s*$/i;

/** What a bare value is, when it's one a datetime attribute would cast: a `Date` or an ISO string. */
function bareDatetime(value: unknown): "Date" | "string" | undefined {
  if (value instanceof Date) return "Date";
  const castable =
    typeof value === "string" && castValue({ type: "datetime" }, value) !== uncastable;
  return castable ? "string" : undefined;
}

/** The column a value at `index` follows, with only a comparison or `BETWEEN` between them. */
function columnBefore(fragment: SafeSql, index: number): ColumnReference | undefined {
  const { strings, values } = fragment;
  const between = strings[index] ?? "";
  const before = values[index - 1];
  if (
    before instanceof ColumnReference &&
    (comparison.test(between) || betweenLower.test(between))
  ) {
    return before;
  }
  // The upper bound: `column BETWEEN lower AND value`.
  const column = values[index - 2];
  const lowerBound = strings[index - 1] ?? "";
  const isUpper = betweenUpper.test(between) && betweenLower.test(lowerBound);
  return isUpper && column instanceof ColumnReference ? column : undefined;
}

/** The column a value at `index` precedes, with only a comparison operator between them. */
function columnAfter(fragment: SafeSql, index: number): ColumnReference | undefined {
  const after = fragment.values[index + 1];
  const between = fragment.strings[index + 1] ?? "";
  return after instanceof ColumnReference && comparison.test(between) ? after : undefined;
}

/**
 * Throws `TypeError` when a fragment compares a bare `Date` (or an ISO datetime string) directly
 * with the column of an attribute stored as a Unix time: it's bound as ISO text, which SQLite
 * orders against an integer the same way every time, so the comparison is never what was meant.
 * Only the text between interpolations is read, never a value; an expression around the column
 * isn't judged.
 */
export function refuseBareDates(model: ModelClass, fragment: SafeSql): void {
  fragment.values.forEach((value, index) => {
    const what = bareDatetime(value);
    if (what === undefined) return;
    const reference = columnBefore(fragment, index) ?? columnAfter(fragment, index);
    if (reference === undefined) return;
    const { storage } = attributeOf(model, reference.attribute);
    if (storage === undefined) return;
    throw new TypeError(
      `${model.name}: a ${what} compared with "${reference.attribute}", which is stored as ` +
        `${storage}, is ISO text and won't compare. Use column("${reference.attribute}").value(…) for it.`,
    );
  });
}
