import {
  CheckViolation,
  ConstraintViolation,
  InvalidForeignKey,
  NotNullViolation,
  RecordNotUnique,
} from "./errors.ts";
import type { ModelClass } from "./model.ts";

type ViolationClass = typeof ConstraintViolation;

/** D1 constraint messages, e.g. "UNIQUE constraint failed: users.email: SQLITE_CONSTRAINT …". */
const KINDS: readonly (readonly [pattern: RegExp, kind: ViolationClass])[] = [
  [/UNIQUE constraint failed: ([^:]+)/, RecordNotUnique],
  [/NOT NULL constraint failed: ([^:]+)/, NotNullViolation],
  [/FOREIGN KEY constraint failed/, InvalidForeignKey],
  [/CHECK constraint failed/, CheckViolation],
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
  for (const [pattern, Kind] of KINDS) {
    const match = pattern.exec(message);
    if (match === null) continue;
    const columns = columnsIn(match[1], model.tableName);
    const attributes = columns.flatMap((column) =>
      [...model.attributeDefinitions].filter(([, d]) => d.column === column).map(([name]) => name),
    );
    const named = columns.length > 0 ? ` (${columns.join(", ")})` : "";
    return new Kind(`${Kind.name}: ${model.name}${named}`, {
      table: model.tableName,
      columns,
      attributes,
      cause: error,
    });
  }
  return error;
}
