import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  belongsTo,
  connect,
  hasMany,
  IncompatibleRelation,
  Model,
  modelFor,
  type QueryEvent,
  sql,
  column,
  withDatabase,
} from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

class User extends Model({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static tableName = "users";

  posts = hasMany(Post, { foreignKey: "userId" });
}

class Post extends Model({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static tableName = "posts";
  static titledAfter = this.scope((q, title: string) =>
    q.where(sql`${column("title")} > ${title}`),
  );

  user = belongsTo(User, { foreignKey: "userId" });
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

  describe("with { count: false }", () => {
    test("fetches one record past the page to learn whether there's a next, in one query", async () => {
      const page = await db().model(Post).paginate({ page: 2, perPage: 2, count: false });

      expect(titles(page.records)).toEqual(["C", "D"]);
      expect({ ...page, records: undefined }).toEqual({
        records: undefined,
        page: 2,
        perPage: 2,
        hasNext: true,
        hasPrevious: true,
      });
      expect(events).toHaveLength(1);
      expect(batches).toBe(0);
    });

    test("on the last page, has no next", async () => {
      const page = await db().model(Post).paginate({ page: 3, perPage: 2, count: false });

      expect(titles(page.records)).toEqual(["E"]);
      expect(page.hasNext).toBe(false);
    });
  });

  describe("untrusted page and perPage", () => {
    test("are cast as an integer attribute is", async () => {
      const page = await db().model(Post).paginate({ page: "2", perPage: " 2 " });

      expect(titles(page.records)).toEqual(["C", "D"]);
      expect([page.page, page.perPage]).toEqual([2, 2]);
    });

    test("missing, null or empty, are the first page and the default size", async () => {
      const params = new URLSearchParams("page=");
      const pages = [
        await db().model(Post).paginate(),
        await db().model(Post).paginate({ page: null, perPage: null }),
        await db()
          .model(Post)
          .paginate({ page: params.get("page"), perPage: params.get("per") }),
      ];

      expect(pages.map(({ page, perPage }) => [page, perPage])).toEqual([
        [1, 25],
        [1, 25],
        [1, 25],
      ]);
    });

    test.each(["abc", "1.5", 1.5, "1e3", 0, "-1", Number.NaN])(
      "%s throws TypeError, as a page or a perPage",
      async (value) => {
        const posts = db().model(Post);

        await expect(posts.paginate({ page: value })).rejects.toThrow(TypeError);
        await expect(posts.paginate({ perPage: value })).rejects.toThrow(TypeError);
        expect(events).toEqual([]);
      },
    );
  });

  describe("perPage and maxPerPage", () => {
    test("default to 25 and 100", () => {
      expect([Model.Base.perPage, Model.Base.maxPerPage]).toEqual([25, 100]);
    });

    test("a larger perPage is capped at maxPerPage, without throwing", async () => {
      const page = await db().model(Post).paginate({ perPage: 1000 });

      expect(page.perPage).toBe(100);
    });

    test("set on an app's base class, every Model built on it inherits them", async () => {
      class Base extends Model.Base {
        static override perPage = 2;
        static override maxPerPage = 3;
      }
      const ApplicationRecord = modelFor(
        {
          posts: {
            attributes: { id: "integer", userId: "integer", title: "string" },
            primaryKey: "id",
          },
        } as const,
        Base,
      );
      class Article extends ApplicationRecord("posts") {}
      class Brief extends ApplicationRecord("posts") {
        static override perPage = 9;
      }

      const pages = [
        await db().model(Article).paginate(),
        await db().model(Article).paginate({ perPage: 4 }),
        await db().model(Brief).paginate(),
      ];

      expect(pages.map(({ perPage }) => perPage)).toEqual([2, 3, 3]);
      expect(pages[0]?.records.map(({ title }) => title)).toEqual(["A", "B"]);
    });
  });

  test("a Relation with its own limit or offset rejects with IncompatibleRelation", async () => {
    const posts = db().model(Post);

    await expect(posts.limit(2).paginate()).rejects.toThrow(IncompatibleRelation);
    await expect(posts.offset(2).paginate({ count: false })).rejects.toThrow(IncompatibleRelation);
    expect(events).toEqual([]);
  });

  test("on none(), is an empty page, without a query", async () => {
    const posts = db().model(Post).none();

    const [counted, countless] = [
      await posts.paginate({ page: 2 }),
      await posts.paginate({ count: false }),
    ];

    expect(counted).toEqual({
      records: [],
      page: 2,
      perPage: 25,
      total: 0,
      totalPages: 0,
      hasNext: false,
      hasPrevious: true,
    });
    expect(countless).toEqual({
      records: [],
      page: 1,
      perPage: 25,
      hasNext: false,
      hasPrevious: false,
    });
    expect(events).toEqual([]);
  });

  test("preloads includes() after the page, as toArray() does", async () => {
    const page = await db().model(Post).includes("user").paginate({ perPage: 2 });

    expect(page.records.map((post) => post.loaded("user")?.email)).toEqual([
      "a@example.com",
      "a@example.com",
    ]);
    expect([batches, events.length]).toEqual([1, 3]);
  });

  test("is a static of every Model, and carries scopes", async () => {
    const page = await withDatabase(db(), () =>
      Post.titledAfter("B").paginate({ perPage: 2, count: false }),
    );
    const total = (await withDatabase(db(), () => Post.paginate())).total;

    expect(titles(page.records)).toEqual(["C", "D"]);
    expect(total).toBe(5);
  });

  test("on a hasMany, queries D1 even when the owner has the records loaded", async () => {
    const user = await db().model(User).includes("posts").findByOrThrow({ id: 1 });
    events.length = 0;

    const page = await user.posts().paginate({ perPage: 2 });

    expect([titles(page.records), page.total]).toEqual([["A", "B"], 5]);
    expect(events).toHaveLength(2);
  });
});
