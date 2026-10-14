// The `Database` that `connect` returns: `db.model()`, sessions, and `db.batch`.
import { NoSession, RecordNotSaved } from "./errors.ts";
import {
  prepareDestroy,
  prepareSave,
  refusalError,
  type Claimed,
  recordsSaving,
} from "./lifecycle.ts";
import { RecordStatement, recordStatementParts } from "./record-statement.ts";
import { state } from "./record-state.ts";
import { runAfter, writeAll, type PreparedWrite } from "./unit-of-work.ts";
import {
  D1Executor,
  pinBefore,
  pinClaimed,
  type Executor,
  type QueryListener,
} from "./executor.ts";
import type { ModelBase, ModelClass, ScopesOf } from "./model.ts";
import type { Scoped } from "./relation.ts";
import { relationFor } from "./scoped-relation.ts";
import { statementParts, type Statement } from "./statement.ts";

/** One request-bound Relation per Model, keyed like the object passed to `db.models()`. */
export type RelationsFor<T extends Record<string, ModelClass<ModelBase>>> = {
  [K in keyof T]: Scoped<InstanceType<T[K]>, ScopesOf<T[K]>>;
};

export interface ConnectOptions {
  /** Called once for every statement sent to D1. */
  onQuery?: QueryListener;
  /**
   * Sends every query through one D1 Session, so the request reads its own writes even when
   * reads are served by replicas: `"first-primary"`, `"first-unconstrained"`, or a bookmark
   * from an earlier request's `db.bookmark()`.
   */
  // `& {}` keeps the two constraint names suggested alongside any bookmark string.
  session?: D1SessionConstraint | (D1SessionBookmark & {});
}

/** @internal The library's key for a Database's D1 binding and Executor (the current database, #77). */
export const databaseParts = Symbol("databaseParts");

/** A per-request wrapper around a D1 binding; every query goes through it. */
export class Database {
  readonly #binding: D1Database;
  readonly #executor: D1Executor;
  readonly #session: D1DatabaseSession | undefined;

  constructor(binding: D1Database, options: ConnectOptions = {}) {
    const { session, onQuery } = options;
    this.#session = session === undefined ? undefined : binding.withSession(session);
    this.#binding = binding;
    this.#executor = new D1Executor(this.#session ?? binding, onQuery);
  }

  /** @internal Its D1 binding (not its Session), to match Models' bindings, and its Executor. */
  get [databaseParts](): { binding: D1Database; executor: D1Executor } {
    return { binding: this.#binding, executor: this.#executor };
  }

  /**
   * The Session's latest bookmark (null before its first query). Pass it to the next request's
   * `connect(env.DB, { session: bookmark })` to read at least as new as this request wrote.
   */
  bookmark(): D1SessionBookmark | null {
    if (this.#session === undefined) {
      throw new NoSession(
        "bookmark() needs a Database opened with a session: connect(env.DB, { session })",
      );
    }
    return this.#session.getBookmark();
  }

  /** A request-bound Relation over the Model's records, with its scopes as methods. */
  model<C extends ModelClass<ModelBase>>(model: C): Scoped<InstanceType<C>, ScopesOf<C>> {
    return relationFor(this.#executor, model);
  }

  /** Request-bound relations for several models at once: `db.models({ User }).User`. */
  models<const T extends Record<string, ModelClass<ModelBase>>>(models: T): RelationsFor<T> {
    // Each entry is exactly db.model(thatModel), so it has that Model's Relation type.
    return Object.fromEntries(
      Object.entries(models).map(([name, model]) => [name, this.model(model)]),
    ) as unknown as RelationsFor<T>;
  }

  /**
   * Runs statements and record statements atomically, with D1's `batch()`: all of them are
   * written, or none. Record statements (`user.toSave()`, `post.toDestroy()`) run
   * their validations and before-callbacks first, in order; the first record that's invalid or
   * aborts throws (`RecordInvalid`, `RecordNotSaved`, `RecordNotDestroyed`) and nothing is sent.
   * After the batch, each record takes its saved state and runs its after-callbacks, in order.
   * Resolves to each entry's result: D1's `meta` for a statement, the record for a record
   * statement. There's no interactive `transaction()`, because D1 can't hold one open across
   * awaits.
   */
  async batch<const T extends readonly BatchEntry[]>(entries: T): Promise<BatchResults<T>> {
    // Every entry on this Database: built on it, or on the current one when it's this.
    return runBatch(entries, "db.batch() needs its statements and records", [this.#executor]);
  }
}

/** The Executor an entry was built on: its Relation's, or its record's. */
function executorOf(entry: BatchEntry): Executor {
  return entry instanceof RecordStatement
    ? entry[recordStatementParts].record[state].executor
    : entry[statementParts].executor;
}

/** The records a batch entry writes: a save's whole autosave graph, or a destroy's record. */
function recordsOf(entry: BatchEntry): ModelBase[] {
  if (!(entry instanceof RecordStatement)) return [];
  const { record, kind } = entry[recordStatementParts];
  return kind === "save" ? recordsSaving(record) : [record];
}

/**
 * A batch's steps: its one database found and every record pinned to it, before anything runs
 * (#93); then before-callbacks, one atomic write, then after-callbacks.
 */
async function runBatch<const T extends readonly BatchEntry[]>(
  entries: T,
  needs: string,
  handles: readonly Executor[] = [],
): Promise<BatchResults<T>> {
  const statements = entries.filter((entry) => !(entry instanceof RecordStatement));
  const all = [...handles, ...statements.map(executorOf)];
  const records = entries.flatMap(recordsOf);
  if (all.length === 0 && records.length === 0) return [] as BatchResults<T>;
  const database = await pinBefore(
    records.map((record) => record[state]),
    needs,
    all,
  );
  // Each record is written once, even if listed twice or already saved by its owner.
  const claimed: Claimed = new Set();
  const prepared: PreparedEntry[] = [];
  for (const entry of entries) {
    prepared.push(
      entry instanceof RecordStatement ? await recordEntry(entry, claimed) : statementEntry(entry),
    );
  }
  await pinClaimed(
    [...claimed].map((record) => record[state]),
    database,
    needs,
  );
  const writes = prepared.flatMap(({ writes }) => writes());
  await writeAll(database, writes);
  await runAfter(writes);
  return prepared.map(({ result }) => result()) as BatchResults<T>;
}

/**
 * `db.batch`, on the database the entries were built on: the current one, for statements and
 * records from a Model's statics (`Product.toUpdateAll(…)`, `Product.build(…).toSave()`), or one
 * explicit `db`. Atomic, as `db.batch` is; entries from two databases throw `IncompatibleRelation`.
 */
export async function batch<const T extends readonly BatchEntry[]>(
  entries: T,
): Promise<BatchResults<T>> {
  // The database they're on now: entries from a Model's statics and from db.model(…) can be one.
  return runBatch(entries, "batch() needs its statements and records");
}

/** What `db.batch` accepts: statements, and records' save or destroy. */
export type BatchEntry = Statement | RecordStatement;

/** `db.batch`'s result for each entry: D1's `meta`, or the saved or destroyed record. */
export type BatchResults<T extends readonly BatchEntry[]> = {
  -readonly [K in keyof T]: T[K] extends RecordStatement<infer R> ? R : D1Meta;
};

interface PreparedEntry {
  /** Built when the batch is: every entry is prepared first, so foreign keys are linked. */
  writes: () => PreparedWrite[];
  result: () => unknown;
}

function statementEntry(statement: Statement): PreparedEntry {
  let meta: D1Meta | undefined;
  const write: PreparedWrite = {
    statements: [statement[statementParts].query],
    commit: ([result]) => {
      meta = result?.meta;
    },
    after: async () => {},
  };
  return { writes: () => [write], result: () => meta };
}

/** A record's prepared save or destroy; a refusal throws, as a Rails transaction's `save!` does. */
async function recordEntry(statement: RecordStatement, claimed: Claimed): Promise<PreparedEntry> {
  const { record, kind } = statement[recordStatementParts];
  const plan = await (kind === "save"
    ? prepareSave(record, claimed)
    : prepareDestroy(record, claimed));
  if (plan.status !== "ready") throw refusalError(record, plan, kind);
  if (plan.stages.length > 1) {
    const { name } = record.constructor;
    throw new RecordNotSaved(
      `${name} can't be saved in a batch with the new records it autosaves: one of them needs a key D1 only generates when a record is written (the ${name}'s, or a new record it points at). Generate keys in code, or save it on its own`,
    );
  }
  return { writes: () => plan.stages.flatMap((stage) => stage()), result: () => record };
}

export function connect(binding: D1Database, options?: ConnectOptions): Database {
  return new Database(binding, options);
}
