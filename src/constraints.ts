import {
  CheckViolation,
  ConstraintViolation,
  InvalidForeignKey,
  NotNullViolation,
  RecordNotUnique,
} from "./errors.ts";
import { attributesForColumn } from "./metadata.ts";
import type { ModelClass } from "./model.ts";

type ViolationClass = typeof ConstraintViolation;

/**
 * D1 constraint messages, e.g. "UNIQUE constraint failed: users.email: SQLITE_CONSTRAINT …".
 * Each kind carries a readable label, since bundlers may rename the error classes.
 */
const KINDS: readonly (readonly [pattern: RegExp, kind: ViolationClass, label: string])[] = [
  [/UNIQUE constraint failed: ([^:]+)/, RecordNotUnique, "not unique"],
  [/NOT NULL constraint failed: ([^:]+)/, NotNullViolation, "must not be null"],
  [/FOREIGN KEY constraint failed/, InvalidForeignKey, "foreign key constraint failed"],
  [/CHECK constraint failed/, CheckViolation, "check constraint failed"],
];

/** "users.email, users.role" → ["email", "role"] (columns of the Model's table only). */
function columnsIn(list: string | undefined, table: string): string[] {
  if (list === undefined) return [];
  return list
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith(`${table}.`))
    .map((entry) => entry.slice(table.length + 1));
}

/**
 * Translates a D1 constraint failure from a write to `model`'s table into the matching
 * `ConstraintViolation`. Any other error is returned unchanged.
 */
export function translateConstraintError(error: unknown, model: ModelClass): unknown {
  const message = error instanceof Error ? error.message : String(error);
  for (const [pattern, Kind, label] of KINDS) {
    const match = pattern.exec(message);
    if (match === null) continue;
    const columns = columnsIn(match[1], model.tableName);
    const attributes = columns.flatMap((column) => attributesForColumn(model, column));
    const named = columns.length > 0 ? ` (${columns.join(", ")})` : "";
    return new Kind(`${model.name}${named}: ${label}`, {
      table: model.tableName,
      columns,
      attributes,
      cause: error,
    });
  }
  return error;
}
