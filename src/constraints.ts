// Turns a D1 constraint failure into the matching `ConstraintViolation` for the written tables.
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

/** What D1's message names: "users.email, users.role" → users, [email, role]. */
interface Named {
  table: string | undefined;
  columns: string[];
}

function namedIn(list: string | undefined): Named {
  const entries = (list ?? "").split(",").map((entry) => entry.trim().split("."));
  const table = entries[0]?.length === 2 ? entries[0][0] : undefined;
  const columns = entries.filter(([name]) => name === table).map(([, column]) => column!);
  return { table, columns };
}

/**
 * Translates a D1 constraint failure from a write to the tables of `models` (one statement's,
 * or a batch's) into the matching `ConstraintViolation`. Any other error is returned unchanged.
 */
export function translateConstraintError(error: unknown, models: readonly ModelClass[]): unknown {
  const message = error instanceof Error ? error.message : String(error);
  for (const [pattern, Kind, label] of KINDS) {
    const match = pattern.exec(message);
    if (match !== null) return violation([Kind, label], namedIn(match[1]), models, error);
  }
  return error;
}

/**
 * The Model a failure belongs to: the one whose table D1's message names, or, when it names
 * none, the only Model written to. Undefined when it names another table (a trigger's), or
 * when a batch writes to several.
 */
function failedModel(
  table: string | undefined,
  models: readonly ModelClass[],
): ModelClass | undefined {
  if (table !== undefined) return models.find((model) => model.tableName === table);
  return new Set(models).size === 1 ? models[0] : undefined;
}

/** `table` is the one D1's message names, or else the failed Model's; null if neither. */
function violation(
  [Kind, label]: readonly [ViolationClass, string],
  { table, columns }: Named,
  models: readonly ModelClass[],
  cause: unknown,
): ConstraintViolation {
  const model = failedModel(table, models);
  const attributes =
    model === undefined ? [] : columns.flatMap((column) => attributesForColumn(model, column));
  const failedTable = table ?? model?.tableName ?? null;
  const named = columns.length > 0 ? ` (${columns.join(", ")})` : "";
  return new Kind(`${model?.name ?? failedTable ?? "batch"}${named}: ${label}`, {
    table: failedTable,
    columns,
    attributes,
    cause,
  });
}
