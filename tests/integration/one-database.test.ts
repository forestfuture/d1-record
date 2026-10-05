import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import {
  belongsTo,
  connect,
  hasMany,
  IncompatibleRelation,
  Model,
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
});
