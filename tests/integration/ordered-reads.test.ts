import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { column, connect, Model, sql, type QueryEvent } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

class Post extends Model({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
  createdAt: "datetime",
}) {
  static tableName = "posts";
}

/**
 * 50 posts, titled so that ordering by title reverses their ids; `title` has no index. Only
 * posts 1 to 10 have a `createdAt`, so which rows a limit keeps changes `count("createdAt")`.
 */
const POSTS = 50;

describe("an order that can't change the answer isn't sent (#215)", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  const events: QueryEvent[] = [];
  const db = () => connect(binding, { onQuery: (event) => events.push(event) });
  const ordered = () => db().model(Post).order({ title: "asc" });
  /** The rows D1 read for the statements since the last reset. */
  const rowsRead = () => events.reduce((sum, event) => sum + (event.meta?.rows_read ?? 0), 0);

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
    await binding.batch([
      binding.prepare("INSERT INTO users (id, email) VALUES (1, 'a@example.com')"),
      binding
        .prepare(
          "INSERT INTO posts (id, user_id, title) SELECT value, 1, printf('Post %02d', ? - value) FROM json_each(?)",
        )
        .bind(POSTS, JSON.stringify(Array.from({ length: POSTS }, (_, index) => index + 1))),
      binding.prepare("UPDATE posts SET created_at = '2026-01-01T00:00:00.000Z' WHERE id <= 10"),
    ]);
  });
  afterAll(() => dispose());
  beforeEach(() => {
    events.length = 0;
  });

  test("exists() on an ordered Relation reads one row", async () => {
    expect(await ordered().exists()).toBe(true);
    expect(rowsRead()).toBe(1);
  });

  test("isEmpty() and hasAny() on an ordered Relation read one row each", async () => {
    expect([await ordered().isEmpty(), await ordered().hasAny()]).toEqual([false, true]);
    expect(rowsRead()).toBe(2);
  });

  test("exists() past an offset reads only up to the offset, ascending or descending", async () => {
    expect(await ordered().offset(10).exists()).toBe(true);
    expect(rowsRead()).toBe(11);

    events.length = 0;
    expect(await db().model(Post).order({ title: "desc" }).offset(10).exists()).toBe(true);
    expect(rowsRead()).toBe(11);
  });

  test("exists() finds the last row, and nothing past it, with or without a limit", async () => {
    expect(await ordered().offset(POSTS).exists()).toBe(false);
    expect(
      await ordered()
        .limit(5)
        .offset(POSTS - 1)
        .exists(),
    ).toBe(true);
  });

  test("count() on an ordered Relation reads each row once, with no sort", async () => {
    expect(await ordered().count()).toBe(POSTS);
    expect(rowsRead()).toBe(POSTS);
  });

  test("count(attribute) on an ordered Relation reads each row once, with no sort", async () => {
    expect(await ordered().count("createdAt")).toBe(10);
    expect(rowsRead()).toBe(POSTS);
  });

  test("paginate()'s count reads each row once, and its page keeps the order", async () => {
    const page = await ordered().paginate({ perPage: 10 });

    expect(page.total).toBe(POSTS);
    expect(page.records.map((post) => post.title).slice(0, 2)).toEqual(["Post 00", "Post 01"]);
    const count = events.find((event) => event.sql.startsWith("SELECT COUNT"));
    expect(count?.meta?.rows_read).toBe(POSTS);
  });

  test("with a limit, count(attribute) counts the rows the order picks", async () => {
    // Ascending titles start at post 50, so the first five have no createdAt; descending, post 1.
    expect(await ordered().limit(5).count("createdAt")).toBe(0);
    expect(await db().model(Post).order({ title: "desc" }).limit(5).count("createdAt")).toBe(5);
  });

  test("with only an offset, count(attribute) counts the rows the order picks", async () => {
    // Ascending, the last five are posts 5 to 1, which have a createdAt; descending, 46 to 50.
    expect(
      await ordered()
        .offset(POSTS - 5)
        .count("createdAt"),
    ).toBe(5);
    expect(
      await db()
        .model(Post)
        .order({ title: "desc" })
        .offset(POSTS - 5)
        .count("createdAt"),
    ).toBe(0);
  });

  test("an sql order with bound values is left out with its values, and kept with them", async () => {
    const third = db()
      .model(Post)
      .where(sql`${column("id")} <= ${20}`)
      .order(sql`CASE WHEN ${column("id")} = ${column("id").value(3)} THEN 0 ELSE 1 END`);

    expect([await third.exists(), await third.count()]).toEqual([true, 20]);
    expect(await third.limit(1).count()).toBe(1);
    expect((await third.limit(1).toArray()).map((post) => post.id)).toEqual([3]);
  });
});
