// Loading a query's records (one SELECT, hydrated, then preloaded), and the keys `find` looks up.
import { castAs, uncastable } from "./attribute-values.ts";
import { compileColumns, compileSelect } from "./compiler.ts";
import { databaseNow, type Executor } from "./executor.ts";
import { hydrate, primaryKeyOf, type ModelBase, type ModelClass } from "./model.ts";
import { keysForIncludes, preload } from "./preload.ts";
import type { QueryDescription } from "./query.ts";

/** The records `query` matches, with its includes preloaded; a `none()` query never reaches D1. */
export async function loadRecords<M extends ModelBase>(
  executor: Executor,
  model: ModelClass<M>,
  query: QueryDescription,
): Promise<M[]> {
  if (query.none) return [];
  // A partial record keeps its primary key, so it keeps its identity — except after
  // distinct(), where adding the key would make every row distinct.
  const loaded =
    query.select && !query.distinct
      ? [...new Set([model.primaryKey, ...keysForIncludes(model, query.includes), ...query.select])]
      : query.select;
  const rows = await executor.all(compileSelect(query, compileColumns(model, loaded)));
  // Bound to the database the query used, which they keep, even past a request's withDatabase.
  const database = await databaseNow(executor);
  const records = rows.map((row) => hydrate(model, row, database));
  if (query.includes !== undefined) await preload(records, query.includes, database);
  return records;
}

/**
 * The primary keys `find(...)` looks up: each cast to the key's type as a condition is, then
 * each once, as Rails does. One that can't be cast stays as given, matches nothing, and is
 * reported missing.
 */
export function keysToFind(model: ModelClass, ids: readonly unknown[]): (string | number)[] {
  const of = { model, attribute: model.primaryKey };
  const keys = ids.map((id) => {
    const cast = castAs("condition", of, id);
    return (cast === uncastable ? id : cast) as string | number;
  });
  return [...new Set(keys)];
}

/** Found `records` in the order of their primary keys in `keys`. */
export function inKeyOrder<M extends ModelBase>(
  records: readonly M[],
  keys: readonly unknown[],
): M[] {
  const byKey = new Map(records.map((record) => [primaryKeyOf(record), record]));
  return keys.map((key) => byKey.get(key) as M);
}
