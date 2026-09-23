import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";

const schema = readFileSync(new URL("../fixtures/schema.sql", import.meta.url), "utf8");

export type TestDatabase = Awaited<ReturnType<Miniflare["getD1Database"]>>;

/**
 * Starts an isolated, in-memory D1 database backed by workerd and applies the
 * fixture schema. Call once per test file and dispose of it in `afterAll`.
 */
export async function createTestDatabase(): Promise<{
  db: TestDatabase;
  dispose: () => Promise<void>;
}> {
  const mf = new Miniflare({
    modules: true,
    script: "export default {}",
    d1Databases: ["DB"],
  });
  const db = await mf.getD1Database("DB");
  const statements = schema
    .split(/;\s*$/m)
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => db.prepare(statement));
  await db.batch(statements);
  return { db, dispose: () => mf.dispose() };
}
