import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";

const fixtureSchema = new URL("../fixtures/schema.sql", import.meta.url);

export type TestDatabase = Awaited<ReturnType<Miniflare["getD1Database"]>>;

/**
 * Starts an isolated, in-memory D1 database backed by workerd and applies the
 * fixture schema (or another, such as a documentation example's migration).
 * Call once per test file and dispose of it in `afterAll`.
 */
export async function createTestDatabase(schema: URL | readonly URL[] = fixtureSchema): Promise<{
  db: TestDatabase;
  dispose: () => Promise<void>;
}> {
  const mf = new Miniflare({
    modules: true,
    script: "export default {}",
    d1Databases: ["DB"],
  });
  const db = await mf.getD1Database("DB");
  // Several files apply in order, as a project's migrations do.
  const statements = (Array.isArray(schema) ? schema : [schema])
    .map((file: URL) => readFileSync(file, "utf8"))
    .join(";\n")
    .split(/;\s*$/m)
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => db.prepare(statement));
  await db.batch(statements);
  return { db, dispose: () => mf.dispose() };
}

/**
 * `binding`, recording the number of statements in each batch it sends. A batch is one round
 * trip to D1, but onQuery reports its statements one by one, so it can't tell one batch from
 * separate queries.
 */
export function recordingBatches(binding: TestDatabase): {
  binding: TestDatabase;
  batches: number[];
} {
  const batches: number[] = [];
  const recording = new Proxy(binding, {
    get(target, key) {
      if (key === "batch") {
        return (statements: Parameters<TestDatabase["batch"]>[0]) => {
          batches.push(statements.length);
          return target.batch(statements);
        };
      }
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { binding: recording, batches };
}
