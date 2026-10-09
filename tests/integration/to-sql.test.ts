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
  beforeEach(() => void (events.length = 0));

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
});
