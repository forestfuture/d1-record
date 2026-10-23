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

/** 50 posts, titled so that ordering by title reverses their ids; `title` has no index. */
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
    ]);
  });
  afterAll(() => dispose());
  beforeEach(() => {
    events.length = 0;
  });

  test("exists() on an ordered Relation reads one row, and so do isEmpty() and hasAny()", async () => {
    expect(await ordered().exists()).toBe(true);
    expect(rowsRead()).toBe(1);

    events.length = 0;
    expect([await ordered().isEmpty(), await ordered().hasAny()]).toEqual([false, true]);
    expect(rowsRead()).toBe(2);
  });
});
