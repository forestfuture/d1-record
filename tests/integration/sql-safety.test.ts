import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { column, connect, Model, sql, type QueryEvent } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  createdAt: "datetime",
}) {
  static tableName = "users";
  // These tests read bound values, so nothing is filtered (#83).
  static override filterAttributes = [];
}

const injection = "' OR 1 = 1 --";

describe("SQL safety", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.prepare("DELETE FROM users").run();
    await binding
      .prepare(
        `INSERT INTO users (id, email, created_at) VALUES
           (1, 'a@example.com', '2026-01-01T00:00:00.000Z'),
           (2, 'b@example.com', '2026-03-01T00:00:00.000Z')`,
      )
      .run();
  });

  test("a value passed to where is bound as a parameter and matches only literally", async () => {
    const queries: QueryEvent[] = [];
    const db = connect(binding, { onQuery: (event) => queries.push(event) });

    const users = await db.model(User).where({ email: injection }).toArray();

    expect(users).toEqual([]);
    expect(queries[0]?.sql).not.toContain(injection);
    expect(queries[0]?.params).toContain(injection);
  });

  test("values interpolated into an sql fragment are bound as parameters", async () => {
    const queries: QueryEvent[] = [];
    const db = connect(binding, { onQuery: (event) => queries.push(event) });

    const matched = await db
      .model(User)
      .where(sql`email = ${"b@example.com"}`)
      .toArray();
    const injected = await db
      .model(User)
      .where(sql`email = ${injection}`)
      .toArray();

    expect(matched.map((user) => user.id)).toEqual([2]);
    expect(injected).toEqual([]);
    expect(queries[1]?.sql).not.toContain(injection);
  });

  test("column() names an attribute's column inside an sql fragment", async () => {
    const queries: QueryEvent[] = [];
    const db = connect(binding, { onQuery: (event) => queries.push(event) });
    const since = new Date(Date.UTC(2026, 1, 1));

    const users = await db
      .model(User)
      .where(sql`${column("createdAt")} > ${since}`)
      .toArray();

    expect(users.map((user) => user.id)).toEqual([2]);
    expect(queries[0]?.sql).toContain('"created_at" > ?');
  });

  test("where rejects a plain string, even one that looks harmless", () => {
    const users = connect(binding).model(User);

    // @ts-expect-error plain strings are not SQL fragments (ADR-0006)
    expect(() => users.where(`email = '${injection}'`)).toThrow(TypeError);
    // @ts-expect-error plain strings are not SQL fragments (ADR-0006)
    expect(() => users.where("email IS NOT NULL")).toThrow(/sql`/);
  });
});
