import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { connect, Model, UnknownAttribute } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

// One attribute per stored form: ISO text, an integer in seconds and in milliseconds, and the
// other types. `secret` is filtered by default.
class Post extends Model({
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
  static tableName = "typed_posts";
}

describe("typeForAttribute: an attribute's conversions, for SQL d1-record doesn't write (#148)", () => {
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

  describe("serialize binds a value as the attribute stores it", () => {
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
    ] as const)("a raw statement on %s compares the same instant", async (column, attribute) => {
      const since = Post.typeForAttribute(attribute).serialize(day(2));

      const { results } = await binding
        .prepare(`SELECT id FROM typed_posts WHERE ${column} >= ? ORDER BY id`)
        .bind(since)
        .all<{ id: number }>();

      expect(results.map((row) => row.id)).toEqual([2, 3]);
    });

    test("it's what a save writes, for every type", async () => {
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
      await binding.prepare("DELETE FROM typed_posts").run();
      await connect(binding)
        .model(Post)
        .create({ id: 1, ...given } as never);

      const row = await rawRow();

      const columns = {
        title: "title",
        publishedAt: "published_at",
        seconds: "seconds",
        milliseconds: "milliseconds",
        featured: "featured",
        rating: "rating",
        score: "score",
        meta: "meta",
        secret: "secret",
      } as const;
      for (const [attribute, column] of Object.entries(columns)) {
        const value = given[attribute as keyof typeof given];
        const serialized = Post.typeForAttribute(attribute as never).serialize(value);
        expect([attribute, serialized]).toEqual([attribute, row![column]]);
      }
    });

    test("a Date with milliseconds is floored for seconds and kept for milliseconds", () => {
      const date = new Date("2026-01-02T03:04:05.678Z");

      expect(Post.typeForAttribute("seconds").serialize(date)).toBe(1767323045);
      expect(Post.typeForAttribute("milliseconds").serialize(date)).toBe(1767323045678);
    });

    test("an ISO string is cast first, so it's written as the attribute stores it", () => {
      expect(Post.typeForAttribute("seconds").serialize("2026-01-02T03:04:05Z")).toBe(1767323045);
      expect(Post.typeForAttribute("publishedAt").serialize("2026-01-02")).toBe(
        "2026-01-02T00:00:00.000Z",
      );
    });

    test("null is NULL", () => {
      expect(Post.typeForAttribute("seconds").serialize(null)).toBeNull();
      expect(Post.typeForAttribute("meta").serialize(null)).toBeNull();
    });
  });

  describe("a value the attribute can't hold throws TypeError naming the Model and attribute", () => {
    test("serialize, as assigning it would", () => {
      expect(() => Post.typeForAttribute("seconds").serialize(1767323045)).toThrow(
        new TypeError(`Post: 1767323045 isn't a datetime for "seconds"`),
      );
      expect(() => Post.typeForAttribute("rating").serialize("abc")).toThrow(
        new TypeError(`Post: "abc" isn't an integer for "rating"`),
      );
    });

    test("cast", () => {
      expect(() => Post.typeForAttribute("featured").cast("yes")).toThrow(
        new TypeError(`Post: "yes" isn't a boolean for "featured"`),
      );
    });

    test.each(["serialize", "cast"] as const)(
      "%s refuses undefined, as assigning does",
      (method) => {
        expect(() => Post.typeForAttribute("seconds")[method](undefined)).toThrow(
          new TypeError(`Post: got undefined for "seconds"; use null to store NULL`),
        );
      },
    );

    test("a filtered attribute's value is hidden", () => {
      expect(() => Post.typeForAttribute("secret").serialize(10n)).toThrow(
        new TypeError(`Post: [FILTERED] isn't a JSON value for "secret"`),
      );
    });
  });

  describe("cast", () => {
    test("is the JavaScript value, as assigned", () => {
      expect(Post.typeForAttribute("seconds").cast("2026-01-02T03:04:05Z")).toEqual(
        new Date("2026-01-02T03:04:05.000Z"),
      );
      expect(Post.typeForAttribute("rating").cast(" 42 ")).toBe(42);
      expect(Post.typeForAttribute("featured").cast("off")).toBe(false);
    });

    test("null stays null", () => {
      expect(Post.typeForAttribute("rating").cast(null)).toBeNull();
    });
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

    test("NULL, and undefined, are null", () => {
      expect(Post.typeForAttribute("seconds").deserialize(null)).toBeNull();
      expect(Post.typeForAttribute("seconds").deserialize(undefined)).toBeNull();
    });

    test("a cell that isn't the stored form throws, as a record load does", () => {
      expect(() => Post.typeForAttribute("seconds").deserialize("abc")).toThrow(
        new TypeError(`Post: "abc" isn't a datetime for "seconds"`),
      );
      expect(() => Post.typeForAttribute("meta").deserialize("not json {")).toThrow(
        new TypeError(`Post: "not json {" isn't a JSON value for "meta"`),
      );
    });

    test("a filtered attribute's cell is hidden", () => {
      expect(() => Post.typeForAttribute("secret").deserialize("not json {")).toThrow(
        new TypeError(`Post: [FILTERED] isn't a JSON value for "secret"`),
      );
    });
  });

  describe("the object", () => {
    test("an unknown attribute is UnknownAttribute", () => {
      expect(() => Post.typeForAttribute("nope" as never)).toThrow(
        new UnknownAttribute(`Post has no attribute "nope"`),
      );
    });

    test("its methods work on their own", () => {
      const { serialize } = Post.typeForAttribute("seconds");

      expect(serialize(new Date("2026-01-02T03:04:05Z"))).toBe(1767323045);
    });
  });
});
