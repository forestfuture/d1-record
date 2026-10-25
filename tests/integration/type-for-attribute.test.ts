import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { connect, Model } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

// One attribute per stored form: ISO text, an integer in seconds and in milliseconds, and the
// other types. The conversions alone are tested without a database, in tests/unit.
class Post extends Model.define({
  id: { type: "integer", null: false },
  title: "string",
  publishedAt: { type: "datetime", column: "published_at" },
  seconds: { type: "datetime", storage: "unixSeconds" },
  milliseconds: { type: "datetime", storage: "unixMilliseconds" },
  featured: "boolean",
  rating: "integer",
  score: "real",
  meta: "json",
  secret: "json",
}) {
  static table = "typed_posts";
}

describe("typeForAttribute against D1: a raw statement and a save agree (#148)", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
    await binding
      .prepare(
        `CREATE TABLE typed_posts (id INTEGER PRIMARY KEY, title TEXT, published_at TEXT,
           seconds INTEGER, milliseconds INTEGER, featured INTEGER, rating INTEGER, score REAL,
           meta TEXT, secret TEXT)`,
      )
      .run();
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.prepare("DELETE FROM typed_posts").run();
  });

  const day = (n: number) => new Date(Date.UTC(2026, 0, n));
  const rawRow = () =>
    binding.prepare("SELECT * FROM typed_posts").first<Record<string, unknown>>();
  const insertRaw = (column: string, value: unknown) =>
    binding.prepare(`INSERT INTO typed_posts (id, ${column}) VALUES (1, ?)`).bind(value).run();

  describe("a raw statement that binds serialize's value", () => {
    beforeEach(async () => {
      await binding.batch(
        [1, 2, 3].map((n) =>
          binding
            .prepare(
              "INSERT INTO typed_posts (id, published_at, seconds, milliseconds) VALUES (?, ?, ?, ?)",
            )
            .bind(n, day(n).toISOString(), day(n).getTime() / 1000, day(n).getTime()),
        ),
      );
    });

    test.each([
      ["published_at", "publishedAt"],
      ["seconds", "seconds"],
      ["milliseconds", "milliseconds"],
    ] as const)("compares the same instant on %s", async (column, attribute) => {
      const since = Post.typeForAttribute(attribute).serialize(day(2));

      const { results } = await binding
        .prepare(`SELECT id FROM typed_posts WHERE ${column} >= ? ORDER BY id`)
        .bind(since)
        .all<{ id: number }>();

      expect(results.map((row) => row.id)).toEqual([2, 3]);
    });
  });

  test("serialize gives what a save writes, for every type", async () => {
    const given = {
      title: "Hello",
      publishedAt: new Date("2026-01-02T03:04:05.678Z"),
      seconds: new Date("2026-01-02T03:04:05.678Z"),
      milliseconds: "2026-01-02T03:04:05.678Z",
      featured: "true",
      rating: "42",
      score: "1.5",
      meta: { a: [1, null] },
      secret: { token: "x" },
    };
    const columns: Record<keyof typeof given, string> = {
      title: "title",
      publishedAt: "published_at",
      seconds: "seconds",
      milliseconds: "milliseconds",
      featured: "featured",
      rating: "rating",
      score: "score",
      meta: "meta",
      secret: "secret",
    };
    await connect(binding)
      .model(Post)
      .create({ id: 1, ...given } as never);

    const row = await rawRow();

    for (const attribute of Object.keys(given) as (keyof typeof given)[]) {
      const serialized = Post.typeForAttribute(attribute).serialize(given[attribute]);
      expect([attribute, serialized]).toEqual([attribute, row![columns[attribute]]]);
    }
  });

  describe("deserialize reads a cell of a raw query as the value a record load gives", () => {
    test.each([
      ["published_at", "publishedAt", "2026-01-02T03:04:05.678Z"],
      ["published_at", "publishedAt", "2026-01-02 03:04:05"],
      ["seconds", "seconds", 1767323045],
      ["milliseconds", "milliseconds", 1767323045678],
      ["featured", "featured", 1],
      ["rating", "rating", 42],
      ["score", "score", 1.5],
      ["meta", "meta", '{"a":[1,null]}'],
    ] as const)("%s as %s from %j", async (column, attribute, cell) => {
      await insertRaw(column, cell);

      const row = await rawRow();
      const loaded = await connect(binding).model(Post).find(1);

      const read = Post.typeForAttribute(attribute).deserialize(row![column]);

      expect(read).toEqual(loaded[attribute]);
    });
  });
});
