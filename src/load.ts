// How a Relation's query runs (on D1, or not at all for `none()`), and the keys `find` looks up.
import { castAs, uncastable } from "./attribute-values.ts";
import { compileColumns, compileSelect, type CompiledSql } from "./compiler.ts";
import { databaseNow, type Executor } from "./executor.ts";
import { hydrate, primaryKeyOf, type ModelBase, type ModelClass } from "./model.ts";
import { keysForIncludes, preload } from "./preload.ts";
import type { QueryDescription } from "./query.ts";

/**
 * How a Relation's query runs. The one place that knows a `none()` query never reaches D1: its
 * Relation's reads find nothing and its bulk writes change nothing, without a database.
 */
export interface QueryRunner<M extends ModelBase> {
  /** The records `description` matches (one SELECT), hydrated, with its includes preloaded. */
  load(description: QueryDescription): Promise<M[]>;
  /** The records `description` matches and the count `count` gives, sent as one batch. */
  loadCounted(description: QueryDescription, count: CompiledSql): Promise<Counted<M>>;
  /** The rows of SQL other than loading records: a count, `exists`, `pluck`. */
  rows(sql: CompiledSql): Promise<Record<string, unknown>[]>;
  /** The rows `write` changed, running it now. */
  changes(write: () => Promise<D1Meta>): Promise<number>;
}

/** Records, and a count sent with them. */
export interface Counted<M extends ModelBase> {
  records: M[];
  count: number;
}

/** How `query`, a Relation's, runs: on `executor`, unless it's a `none()` query. */
export function runnerFor<M extends ModelBase>(
  executor: Executor,
  model: ModelClass<M>,
  query: QueryDescription,
): QueryRunner<M> {
  if (query.none) return nothing;
  return {
    load: (description) => loadRecords(executor, model, description),
    loadCounted: (description, count) => loadCounted(executor, model, description, count),
    rows: (sql) => executor.all(sql),
    changes: async (write) => (await write()).changes,
  };
}

/** A `none()` query's runner: nothing is sent, so nothing is found or changed. */
const nothing: QueryRunner<never> = {
  load: async () => [],
  loadCounted: async () => ({ records: [], count: 0 }),
  rows: async () => [],
  changes: async () => 0,
};

/** One SELECT for `query`'s records, hydrated, then its includes preloaded. */
async function loadRecords<M extends ModelBase>(
  executor: Executor,
  model: ModelClass<M>,
  query: QueryDescription,
): Promise<M[]> {
  return hydrated(executor, model, query, await executor.all(selectFor(model, query)));
}

/** `count` and the SELECT for `query`'s records as one batch: one round trip. */
async function loadCounted<M extends ModelBase>(
  executor: Executor,
  model: ModelClass<M>,
  query: QueryDescription,
  count: CompiledSql,
): Promise<Counted<M>> {
  const [counted, loaded] = await executor.batch([count, selectFor(model, query)]);
  const records = await hydrated(executor, model, query, loaded?.results ?? []);
  return { records, count: Number(counted?.results[0]?.["count"] ?? 0) };
}

/** The SELECT for `query`'s records. */
function selectFor(model: ModelClass, query: QueryDescription): CompiledSql {
  // A partial record keeps its primary key, so it keeps its identity — except after
  // distinct(), where adding the key would make every row distinct.
  const loaded =
    query.select && !query.distinct
      ? [...new Set([model.primaryKey, ...keysForIncludes(model, query.includes), ...query.select])]
      : query.select;
  return compileSelect(query, compileColumns(model, loaded));
}

/** `rows` of `query` as records, then its includes preloaded. */
async function hydrated<M extends ModelBase>(
  executor: Executor,
  model: ModelClass<M>,
  query: QueryDescription,
  rows: readonly Record<string, unknown>[],
): Promise<M[]> {
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
