import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import {
  batch,
  belongsTo,
  connect,
  hasMany,
  IncompatibleRelation,
  Model,
  type QueryEvent,
  withDatabase,
} from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

// Level 1 reads the Worker's bindings from cloudflare:workers; here it's this test's first D1.
const workers: { env: Record<string, unknown> } = { env: {} };
vi.mock("cloudflare:workers", () => workers);

class Post extends Model({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
  published: "boolean",
}) {
  static tableName = "posts";
  static override binding = "DB";
  static isPublished = this.scope((q) => q.where({ published: true }));

  author = belongsTo(User, { foreignKey: "userId" });
}

class User extends Model({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static tableName = "users";
  static override binding = "DB";

  posts = hasMany(Post, { foreignKey: "userId" });
}

// One database per query, write and record, whichever level it came from (#93, ADR-0012).
describe("one database", () => {
  let one: TestDatabase;
  let two: TestDatabase;
  const disposals: (() => Promise<void>)[] = [];

  beforeAll(async () => {
    for (const each of [0, 1]) {
      const { db, dispose } = await createTestDatabase();
      disposals.push(dispose);
      if (each === 0) one = db;
      else two = db;
    }
    workers.env = { DB: one };
  });
  afterAll(async () => {
    for (const dispose of disposals) await dispose();
  });
  beforeEach(async () => {
    for (const db of [one, two]) {
      await db.batch([db.prepare("DELETE FROM posts"), db.prepare("DELETE FROM users")]);
    }
    await connect(one).model(User).insert({ id: 1, email: "ada@example.com" });
    await connect(one)
      .model(Post)
      .insertAll([
        { id: 10, userId: 1, title: "Draft", published: false },
        { id: 11, userId: 1, title: "Out", published: true },
      ]);
  });

  describe("merge and or are checked when the query runs", () => {
    test("a loaded record's association combines with a static on the same database", async () => {
      const titles = await withDatabase(connect(one), async () => {
        const user = await User.find(1);
        return [
          await user.posts().merge(Post.isPublished()).pluck("title"),
          await user
            .posts()
            .or(Post.where({ title: "Draft" }))
            .order({ id: "asc" })
            .pluck("title"),
        ];
      });

      expect(titles).toEqual([["Out"], ["Draft", "Out"]]);
    });

    test("relations on two explicit databases are refused when they run, naming where each is from", async () => {
      const merged = connect(one)
        .model(Post)
        .where({ published: true })
        .merge(connect(two).model(Post).where({}));

      await expect(merged.toArray()).rejects.toThrow(
        new IncompatibleRelation(
          "merge() needs its relations on one database; these are on a connect() database and another",
        ),
      );
    });
  });

  describe("every record a write touches keeps the database it ran on", () => {
    test("records autosaved with a statics-built owner stay on the request's database", async () => {
      const seen: QueryEvent[] = [];
      const request = connect(one, { onQuery: (event) => seen.push(event) });
      let post!: Post;
      await withDatabase(request, async () => {
        const user = User.build({ id: 2, email: "grace@example.com" });
        post = user.posts().build({ id: 20, title: "Draft" });
        await user.save();
      });

      seen.length = 0;
      await post.update({ title: "Changed" });

      expect(seen.map((event) => event.sql.split(" ")[0])).toEqual(["UPDATE"]);
    });

    test("so do records autosaved in a batch", async () => {
      const seen: QueryEvent[] = [];
      let post!: Post;
      await withDatabase(connect(one, { onQuery: (event) => seen.push(event) }), async () => {
        const user = User.build({ id: 3, email: "linus@example.com" });
        post = user.posts().build({ id: 30, title: "Draft" });
        await batch([user.toSave()]);
      });

      seen.length = 0;
      await post.update({ title: "Changed" });

      expect(seen).toHaveLength(1);
    });
  });

  describe("a save is one database", () => {
    test("a belongsTo target on another database is refused before anything is written", async () => {
      const post = connect(one).model(Post).build({ id: 40, title: "Orphan" });
      post.author.set(connect(two).model(User).build({ id: 4, email: "c@example.com" }));

      await expect(post.save()).rejects.toThrow(
        new IncompatibleRelation(
          "save() needs its records on one database; these are on a connect() database and another",
        ),
      );
      for (const db of [one, two]) {
        expect(await db.prepare("SELECT count(*) AS n FROM users WHERE id = 4").first("n")).toBe(0);
        expect(await db.prepare("SELECT count(*) AS n FROM posts WHERE id = 40").first("n")).toBe(
          0,
        );
      }
    });

    test("a statics-built target saves with an owner on the same database", async () => {
      await withDatabase(connect(one), async () => {
        const post = Post.build({ id: 41, title: "Hello" });
        post.author.set(User.build({ id: 5, email: "e@example.com" }));
        expect(await post.save()).toBe(true);
      });

      expect((await connect(one).model(Post).find(41)).userId).toBe(5);
    });
  });
});
