import type { CompiledSql } from "./compiler.ts";
import { translateConstraintError } from "./constraints.ts";

/** Reported to `onQuery` once for every statement sent to D1. */
export interface QueryEvent {
  sql: string;
  params: unknown[];
  durationMs: number;
  meta?: D1Meta;
  error?: unknown;
}

export type QueryListener = (event: QueryEvent) => void;

/**
 * The single place the library calls D1: every statement is reported to `onQuery`, and a
 * constraint failure becomes the matching `ConstraintViolation` for the statement's Model.
 */
export class Executor {
  readonly #binding: D1Database | D1DatabaseSession;
  readonly #onQuery: QueryListener | undefined;

  /** `binding` is the D1 binding itself, or one D1 Session every query goes through. */
  constructor(binding: D1Database | D1DatabaseSession, onQuery?: QueryListener) {
    this.#binding = binding;
    this.#onQuery = onQuery;
  }

  /** Runs one statement and resolves to its rows. */
  async all(query: CompiledSql): Promise<Record<string, unknown>[]> {
    return (await this.#one(query)).results;
  }

  /** Runs one statement for its effect and resolves to D1's `meta`. */
  async run(query: CompiledSql): Promise<D1Meta> {
    return (await this.#one(query)).meta;
  }

  /**
   * Runs statements atomically with D1's `batch()` and resolves to each one's result (rows and
   * `meta`). D1 fails a batch as a whole, so on failure every statement is reported with the error.
   */
  async batch(statements: readonly CompiledSql[]): Promise<D1Result<Record<string, unknown>>[]> {
    if (statements.length === 0) return [];
    const started = performance.now();
    let results: D1Result<Record<string, unknown>>[];
    try {
      results = await this.#binding.batch<Record<string, unknown>>(
        statements.map((statement) => this.#prepare(statement)),
      );
    } catch (error) {
      const durationMs = performance.now() - started;
      for (const { sql, params } of statements) this.#onQuery?.({ sql, params, durationMs, error });
      throw translateConstraintError(
        error,
        statements.map(({ model }) => model),
      );
    }
    // D1 times each statement of a batch itself.
    statements.forEach(({ sql, params }, index) => {
      const { meta } = results[index]!;
      this.#onQuery?.({ sql, params, durationMs: meta.duration, meta });
    });
    return results;
  }

  /** Runs statements atomically: one on its own, several as one batch. Resolves to each result. */
  async write(statements: readonly CompiledSql[]): Promise<D1Result<Record<string, unknown>>[]> {
    const [only] = statements;
    if (statements.length === 1 && only !== undefined) return [await this.#one(only)];
    return this.batch(statements);
  }

  async #one(query: CompiledSql): Promise<D1Result<Record<string, unknown>>> {
    const { sql, params, model } = query;
    const started = performance.now();
    let result: D1Result<Record<string, unknown>>;
    try {
      result = await this.#prepare(query).all<Record<string, unknown>>();
    } catch (error) {
      this.#onQuery?.({ sql, params, durationMs: performance.now() - started, error });
      throw translateConstraintError(error, [model]);
    }
    // Reported outside the try, so a listener that throws isn't mistaken for a D1 failure.
    this.#onQuery?.({ sql, params, durationMs: performance.now() - started, meta: result.meta });
    return result;
  }

  #prepare({ sql, params }: CompiledSql): D1PreparedStatement {
    return this.#binding.prepare(sql).bind(...params);
  }
}
