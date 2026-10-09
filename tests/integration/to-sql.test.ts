import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { connect, hasMany, Model, type QueryEvent } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

class User extends Model({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
  age: "integer",
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
}

describe("toSql", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());

  const events: QueryEvent[] = [];
  const db = () => connect(binding, { onQuery: (event) => events.push(event) });
  const sent = () => events.map((event) => ({ sql: event.sql, params: event.params }));
  beforeEach(async () => {
    events.length = 0;
    await binding.batch([
      binding.prepare("DELETE FROM posts"),
      binding.prepare("DELETE FROM users"),
      binding.prepare("INSERT INTO users (id, email) VALUES (1, 'a@example.com')"),
      binding.prepare("INSERT INTO users (id, email) VALUES (2, 'b@example.com')"),
    ]);
  });

  describe("a Relation", () => {
    test("is the SELECT toArray sends, with its values bound, and sends nothing itself", async () => {
      const admins = db().model(User).where({ role: "admin" }).order({ email: "asc" }).limit(5);

      const { sql, params } = admins.toSql();

      expect(events).toEqual([]);
      expect(params).toEqual(["admin", 5]);
      expect(sql).not.toContain("admin");
      await admins.toArray();
      expect(sent()).toEqual([{ sql, params }]);
    });

    // A guard: toSql shares the compiler with toArray, so this passes as soon as it exists.
    test("shows the columns a partial record really loads, including the keys includes needs", async () => {
      const users = db().model(User).select("email").includes("posts");

      const { sql, params } = users.toSql();

      expect(sql).toContain('"id"');
      await users.toArray();
      expect(sent()[0]).toEqual({ sql, params });
    });
  });

  describe("a Statement", () => {
    test("is the SQL db.batch sends for it, and building or inspecting it sends nothing", async () => {
      const database = db();
      const posts = database.model(Post);
      const statements = [
        posts.toInsert({ userId: 1, title: "Hello" }),
        posts.toInsertAll([
          { userId: 1, title: "A" },
          { userId: 1, title: "B" },
        ]),
        posts.where({ userId: 1 }).toUpdateAll({ title: "Renamed" }),
        posts.where({ userId: 2 }).toDeleteAll(),
      ];

      const shown = statements.map((statement) => statement.toSql());

      expect(events).toEqual([]);
      expect(shown.map(({ sql }) => sql)).toEqual([
        expect.stringMatching(/^INSERT INTO "posts"/),
        expect.stringMatching(/^INSERT INTO "posts"/),
        expect.stringMatching(/^UPDATE "posts"/),
        expect.stringMatching(/^DELETE FROM "posts"/),
      ]);
      await database.batch(statements);
      expect(sent()).toEqual(shown);
    });
  });
});
