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
