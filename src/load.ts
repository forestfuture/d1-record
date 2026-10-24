// How a Relation's query runs (on D1, or not at all for `none()`), and the keys `find` looks up.
import { attributeFor, noMatch } from "./attribute.ts";
import { compileColumns, compileSelect, type CompiledSql } from "./compiler.ts";
import { databaseNow, type Executor } from "./executor.ts";
import { hydrate, primaryKeyOf, type ModelBase, type ModelClass } from "./model.ts";
import { keysForIncludes, planPreload, sendTogether } from "./preload.ts";
import type { QueryDescription } from "./query.ts";
import { sql } from "./sql.ts";

/**
 * How a Relation's query runs. The one place that knows a `none()` query never reaches D1: its
 * Relation's reads find nothing and its bulk writes change nothing, without a database.
 */
export interface QueryRunner<M extends ModelBase> {
  /** The records `description` matches (one SELECT), hydrated, with its includes preloaded. */
  load(description: QueryDescription): Promise<M[]>;
  /** The records `description` matches and the count `countSql` gives, sent as one batch. */
  loadCounted(description: QueryDescription, countSql: CompiledSql): Promise<Counted<M>>;
  /**
   * The records `description` matches (one SELECT, its limit given), and whether more follow:
   * one row past the limit is read to learn that, and isn't hydrated or preloaded.
   */
  loadAhead(description: QueryDescription & { limit: number }): Promise<LoadedAhead<M>>;
  /** The rows of SQL other than loading records: a count, `exists`, `pluck`. */
  rows(sql: CompiledSql): Promise<Record<string, unknown>[]>;
  /** The rows `write` changed, running it now. */
  changes(write: () => Promise<D1Meta>): Promise<number>;
}

/** Records, and a count sent with them. */
interface Counted<M extends ModelBase> {
  records: M[];
  count: number;
}

/** Records, and whether more follow them. */
interface LoadedAhead<M extends ModelBase> {
  records: M[];
  hasMore: boolean;
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
    loadCounted: (description, countSql) => loadCounted(executor, model, description, countSql),
    loadAhead: (description) => loadAhead(executor, model, description),
    rows: (sql) => executor.all(sql),
    changes: async (write) => (await write()).changes,
  };
}

/** A `none()` query's runner: nothing is sent, so nothing is found or changed. */
const nothing: QueryRunner<never> = {
  load: async () => [],
  loadCounted: async () => ({ records: [], count: 0 }),
  loadAhead: async () => ({ records: [], hasMore: false }),
  rows: async () => [],
  changes: async () => 0,
};

/** One SELECT for `query`'s records, hydrated, with its includes preloaded. */
async function loadRecords<M extends ModelBase>(
  executor: Executor,
  model: ModelClass<M>,
  query: QueryDescription,
): Promise<M[]> {
  const own = [selectFor(model, query)];
  return (await loadWith(executor, model, { query, own, rowsOf: ([rows]) => rows })).records;
}

/** `countSql` and the SELECT for `query`'s records as one batch: one round trip. */
async function loadCounted<M extends ModelBase>(
  executor: Executor,
  model: ModelClass<M>,
  query: QueryDescription,
  countSql: CompiledSql,
): Promise<Counted<M>> {
  const own = [countSql, selectFor(model, query)];
  const loaded = await loadWith(executor, model, { query, own, rowsOf: ([, rows]) => rows });
  const [counted] = loaded.results;
  return { records: loaded.records, count: Number(counted?.[0]?.["count"] ?? 0) };
}

/** One SELECT for `query`'s records and one past its limit, which is read but not loaded. */
async function loadAhead<M extends ModelBase>(
  executor: Executor,
  model: ModelClass<M>,
  query: QueryDescription & { limit: number },
): Promise<LoadedAhead<M>> {
  const own = [selectFor(model, { ...query, limit: query.limit + 1 })];
  const rowsOf = ([rows]: readonly Rows[]) => rows?.slice(0, query.limit);
  const { records, results } = await loadWith(executor, model, { query, own, rowsOf });
  return { records, hasMore: (results[0]?.length ?? 0) > query.limit };
}

/** Rows D1 returned for one statement. */
type Rows = Record<string, unknown>[];

/** What a load sends of its own (its SELECT, and a count), and which of their rows are records. */
interface Load {
  query: QueryDescription;
  own: readonly CompiledSql[];
  rowsOf: (results: readonly Rows[]) => readonly Record<string, unknown>[] | undefined;
}

/**
 * Sends a load's own statements and those preloading its query's includes together, in one
 * round trip, then makes its records and attaches the preloads. Resolves to the records and
 * the own statements' rows.
 */
async function loadWith<M extends ModelBase>(
  executor: Executor,
  model: ModelClass<M>,
  { query, own, rowsOf }: Load,
): Promise<{ records: M[]; results: Rows[] }> {
  const plan = query.includes === undefined ? undefined : planPreload(query, executor);
  const results = await sendTogether(executor, [...own, ...(plan?.statements ?? [])]);
  // Bound to the database the query used, which they keep, even past a request's withDatabase.
  const database = await databaseNow(executor);
  const records = (rowsOf(results) ?? []).map((row) => hydrate(model, row, database));
  await plan?.attach([records], results.slice(own.length), database);
  return { records, results: results.slice(0, own.length) };
}

/** The SELECT for `query`'s records. */
export function selectFor(model: ModelClass, query: QueryDescription): CompiledSql {
  // A partial record keeps its primary key, so it keeps its identity — except after
  // distinct(), where adding the key would make every row distinct.
  const loaded =
    query.select && !query.distinct
      ? [...new Set([model.primaryKey, ...keysForIncludes(model, query.includes), ...query.select])]
      : query.select;
  return compileSelect(query, compileColumns(model, loaded));
}

/**
 * The SELECT `toSql()` shows for `query`. A `none()` query is never sent, so it shows what
 * matching nothing would be: its conditions and `1 = 0`.
 */
export function selectForToSql(model: ModelClass, query: QueryDescription): CompiledSql {
  const never = sql`1 = 0`;
  return selectFor(
    model,
    query.none ? { ...query, conditions: [...query.conditions, never] } : query,
  );
}

/**
 * The primary keys `find(...)` looks up: each cast to the key's type as a condition is, then
 * each once, as Rails does. One that can't be cast stays as given, matches nothing, and is
 * reported missing.
 */
export function keysToFind(model: ModelClass, ids: readonly unknown[]): (string | number)[] {
  const key = attributeFor(model, model.primaryKey);
  const keys = ids.map((id) => {
    const cast = key.condition(id);
    return (cast === noMatch ? id : cast) as string | number;
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
