// `withDatabase`, and where a query from a Model's statics (`Product.find(id)`) finds its database.
// It's the request's, set with `withDatabase`, or else the Model's binding from
// `cloudflare:workers` (#77). Nothing
// per-request is ever stored on a class (ADR-0003): a request's database lives only in its
// AsyncLocalStorage, and a binding's Database holds no per-request state.
import { connect, databaseParts, type Database } from "./database.ts";
import { NoDatabase } from "./errors.ts";
import {
  CurrentExecutor,
  type D1Executor,
  describeDatabasesWith,
  type Executor,
} from "./executor.ts";
import type { ModelClass, ScopesOf } from "./model.ts";
import type { Scoped } from "./relation.ts";
import { relationFor } from "./scoped-relation.ts";

interface Storage<T> {
  getStore(): T | undefined;
  run<R>(store: T, fn: () => R): R;
}

/** The databases `withDatabase` set for the current request, once it's been called. */
let requests: Storage<readonly Database[]> | undefined;

/** Node's AsyncLocalStorage, loaded when it's first needed, so Workers without Node.js compatibility still build. */
function newStorage(): Storage<readonly Database[]> {
  const process = (globalThis as { process?: { getBuiltinModule?(id: string): unknown } }).process;
  const hooks = process?.getBuiltinModule?.("node:async_hooks") as
    | { AsyncLocalStorage: new () => Storage<readonly Database[]> }
    | undefined;
  if (hooks === undefined) {
    throw new NoDatabase(
      "withDatabase needs Node.js compatibility: a compatibility_date of 2026-08-04 or later, " +
        "or the nodejs_compat flag, in your Wrangler config",
    );
  }
  return new hooks.AsyncLocalStorage();
}

/**
 * Runs `fn` with `databases` as the request's own: queries started from a Model inside it (and
 * everything it awaits) use the one on that Model's binding, with its Session and `onQuery`.
 * Usually called once per request, in middleware. Nested calls add to the outer ones.
 */
export async function withDatabase<R>(
  databases: Database | readonly Database[],
  fn: () => R | Promise<R>,
): Promise<R> {
  requests ??= newStorage();
  const outer = requests.getStore() ?? [];
  const inner = Array.isArray(databases) ? databases : [databases as Database];
  return requests.run([...inner, ...outer], fn);
}

type Env = Record<string, unknown>;

/** The Worker's bindings, from `cloudflare:workers`; undefined outside a Worker (Node, scripts). */
let workersEnv: Promise<Env | undefined> | undefined;

function bindings(): Promise<Env | undefined> {
  // A literal specifier: Wrangler and Miniflare (wrangler dev) only allow those. Outside a Worker
  // the module doesn't exist, which is the one failure that means "not in a Worker".
  workersEnv ??= import("cloudflare:workers").then(
    (workers) => workers.env as unknown as Env,
    (error: unknown) => {
      if (notAWorker(error)) return undefined;
      throw error;
    },
  );
  return workersEnv;
}

/** Whether importing `cloudflare:workers` failed because this isn't a Worker (Node, scripts). */
function notAWorker(error: unknown): boolean {
  const { code, message } = error as { code?: unknown; message?: unknown };
  return (
    code === "ERR_UNSUPPORTED_ESM_URL_SCHEME" ||
    code === "ERR_MODULE_NOT_FOUND" ||
    /cloudflare:workers/.test(String(message))
  );
}

/** Each binding's own database, by its binding's name, for errors to name. */
const bindingNames = new WeakMap<D1Executor, string>();

// Errors name each database (#93): the request's (from withDatabase), a binding's, or connect()'s.
describeDatabasesWith((database) => {
  if (requests?.getStore()?.some((db) => db[databaseParts].executor === database)) {
    return "the request's database";
  }
  const name = bindingNames.get(database);
  return name === undefined ? "a connect() database" : `the ${name} binding's database`;
});

/** One Database per D1 binding, for queries outside `withDatabase`: it holds nothing per-request. */
const defaults = new WeakMap<D1Database, Database>();

function defaultDatabase(binding: D1Database, name: string): Database {
  let db = defaults.get(binding);
  if (db === undefined) {
    db = connect(binding);
    bindingNames.set(db[databaseParts].executor, name);
    defaults.set(binding, db);
  }
  return db;
}

/** Why there's no database here, saying what to do. */
function noDatabase(reason: string): NoDatabase {
  return new NoDatabase(
    `No database for this query: ${reason}. Wrap the code in withDatabase(connect(env.DB), …), ` +
      "or use db.model(Model)",
  );
}

/** Outside a Worker (Node, scripts), a request's database is the only one there can be. */
function onlyRequested(requested: readonly Database[], name: string | undefined): Database {
  if (requested.length === 1) return requested[0]!;
  if (requested.length > 1) {
    throw noDatabase(
      "withDatabase was given several, and outside a Worker a binding can't tell which",
    );
  }
  throw noDatabase(
    name === undefined
      ? 'its Model names no binding (static binding = "DB", in its base class)'
      : `the binding ${name} is only there inside a Worker`,
  );
}

/** The database a query on binding `name` uses now: the request's for it, or the binding's own. */
async function databaseFor(name: string | undefined): Promise<Database> {
  const requested = requests?.getStore() ?? [];
  const env = name === undefined ? undefined : await bindings();
  if (env === undefined || name === undefined) return onlyRequested(requested, name);
  const binding = env[name] as D1Database | undefined;
  if (binding === undefined) {
    throw new NoDatabase(
      `The binding ${name} isn't in this Worker's env; check d1_databases in your Wrangler config`,
    );
  }
  return (
    requested.find((db) => db[databaseParts].binding === binding) ?? defaultDatabase(binding, name)
  );
}

/**
 * One Executor per binding name (a Model's `static binding`), finding the current database each
 * time a query runs; Models on one binding share it, so their statements can share a batch.
 */
const executors = new Map<string | undefined, Executor>();

/** The Executor for queries started from a Model on binding `name`. */
function currentExecutor(name: string | undefined): Executor {
  let executor = executors.get(name);
  if (executor === undefined) {
    executor = new CurrentExecutor(async () => (await databaseFor(name))[databaseParts].executor);
    executors.set(name, executor);
  }
  return executor;
}

/** A Relation over all of `model`'s records, on the current database (`Product.all()`). */
export function currentRelation<C extends ModelClass>(
  model: C,
): Scoped<InstanceType<C>, ScopesOf<C>> {
  return relationFor(currentExecutor(model.binding), model);
}
