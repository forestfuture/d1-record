import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { Model } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

// One attribute per stored form: ISO text, an integer in seconds and in milliseconds.
class Post extends Model({
  id: { type: "integer", null: false },
  title: "string",
  publishedAt: { type: "datetime", column: "published_at" },
  seconds: { type: "datetime", storage: "unixSeconds" },
  milliseconds: { type: "datetime", storage: "unixMilliseconds" },
}) {
  static tableName = "typed_posts";
}

describe("typeForAttribute: an attribute's conversions, for SQL d1-record doesn't write (#148)", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
    await binding
      .prepare(
        "CREATE TABLE typed_posts (id INTEGER PRIMARY KEY, title TEXT, published_at TEXT, seconds INTEGER, milliseconds INTEGER)",
      )
      .run();
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.prepare("DELETE FROM typed_posts").run();
  });

  const day = (n: number) => new Date(Date.UTC(2026, 0, n));

  describe("serialize binds a value as the attribute stores it", () => {
    beforeEach(async () => {
      await binding.batch(
        [1, 2, 3].map((n) =>
          binding
            .prepare("INSERT INTO typed_posts VALUES (?, ?, ?, ?, ?)")
            .bind(n, `post ${n}`, day(n).toISOString(), day(n).getTime() / 1000, day(n).getTime()),
        ),
      );
    });

    test.each([
      ["published_at", "publishedAt"],
      ["seconds", "seconds"],
      ["milliseconds", "milliseconds"],
    ] as const)("a raw statement on %s compares the same instant", async (column, attribute) => {
      const since = Post.typeForAttribute(attribute).serialize(day(2));

      const { results } = await binding
        .prepare(`SELECT id FROM typed_posts WHERE ${column} >= ? ORDER BY id`)
        .bind(since)
        .all<{ id: number }>();

      expect(results.map((row) => row.id)).toEqual([2, 3]);
    });
  });
});
