/** Reported to `onQuery` once for every statement sent to D1. */
export interface QueryEvent {
  sql: string;
  params: unknown[];
  durationMs: number;
  meta?: D1Meta;
  error?: unknown;
}

export type QueryListener = (event: QueryEvent) => void;

/** The single place the library calls D1. */
export class Executor {
  readonly #binding: D1Database;
  readonly #onQuery: QueryListener | undefined;

  constructor(binding: D1Database, onQuery?: QueryListener) {
    this.#binding = binding;
    this.#onQuery = onQuery;
  }

  async all(sql: string, params: unknown[]): Promise<Record<string, unknown>[]> {
    const started = performance.now();
    let result: D1Result<Record<string, unknown>>;
    try {
      result = await this.#binding
        .prepare(sql)
        .bind(...params)
        .all<Record<string, unknown>>();
    } catch (error) {
      this.#onQuery?.({ sql, params, durationMs: performance.now() - started, error });
      throw error;
    }
    // Reported outside the try, so a listener that throws isn't mistaken for a D1 failure.
    this.#onQuery?.({ sql, params, durationMs: performance.now() - started, meta: result.meta });
    return result.results;
  }
}
