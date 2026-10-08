import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { connect, Model, type QueryEvent } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

class Post extends Model({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static tableName = "posts";
}

describe("paginate", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  const events: QueryEvent[] = [];
  let batches = 0;
  // The binding, counting its batches: each is one round trip to D1.
  const counting = () =>
    new Proxy(binding, {
      get(target, key) {
        if (key === "batch") {
          return (statements: Parameters<TestDatabase["batch"]>[0]) => {
            batches += 1;
            return target.batch(statements);
          };
        }
        const value: unknown = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  const db = () => connect(counting(), { onQuery: (event) => events.push(event) });
  const titles = (records: readonly Post[]) => records.map((post) => post.title);

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.batch([
      binding.prepare("DELETE FROM posts"),
      binding.prepare("DELETE FROM users"),
      binding.prepare("INSERT INTO users (id, email) VALUES (1, 'a@example.com')"),
      binding.prepare(
        "INSERT INTO posts (id, user_id, title) VALUES (5, 1, 'E'), (3, 1, 'C'), (1, 1, 'A'), (4, 1, 'D'), (2, 1, 'B')",
      ),
    ]);
    events.length = 0;
    batches = 0;
  });

  test("resolves to a page of records and its total, by primary key, in one batch", async () => {
    const page = await db().model(Post).paginate({ page: 2, perPage: 2 });

    expect(titles(page.records)).toEqual(["C", "D"]);
    expect({ ...page, records: undefined }).toEqual({
      records: undefined,
      page: 2,
      perPage: 2,
      total: 5,
      totalPages: 3,
      hasNext: true,
      hasPrevious: true,
    });
    expect(batches).toBe(1);
    expect(events).toHaveLength(2);
  });

  test("keeps the Relation's conditions and order", async () => {
    const page = await db()
      .model(Post)
      .where({ id: [1, 2, 3, 4] })
      .order({ title: "desc" })
      .paginate({ page: 1, perPage: 3 });

    expect(titles(page.records)).toEqual(["D", "C", "B"]);
    expect([page.total, page.totalPages, page.hasNext, page.hasPrevious]).toEqual([
      4,
      2,
      true,
      false,
    ]);
  });

  test("past the last page, has no records but the real total", async () => {
    const page = await db().model(Post).paginate({ page: 9, perPage: 2 });

    expect(page.records).toEqual([]);
    expect([page.total, page.totalPages, page.hasNext, page.hasPrevious]).toEqual([
      5,
      3,
      false,
      true,
    ]);
  });
});
