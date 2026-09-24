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
    try {
      const result = await this.#binding
        .prepare(sql)
        .bind(...params)
        .all<Record<string, unknown>>();
      this.#onQuery?.({ sql, params, durationMs: performance.now() - started, meta: result.meta });
      return result.results;
    } catch (error) {
      this.#onQuery?.({ sql, params, durationMs: performance.now() - started, error });
      throw error;
    }
  }
}
