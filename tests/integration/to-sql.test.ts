import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { connect, Model, type QueryEvent } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

class User extends Model({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
  age: "integer",
}) {
  static tableName = "users";
}

describe("toSql", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());

  describe("a Relation", () => {
    test("is the SELECT toArray sends, with its values bound, and sends nothing itself", async () => {
      const events: QueryEvent[] = [];
      const db = connect(binding, { onQuery: (event) => events.push(event) });
      const admins = db.model(User).where({ role: "admin" }).order({ email: "asc" }).limit(5);

      const { sql, params } = admins.toSql();

      expect(events).toEqual([]);
      expect(params).toEqual(["admin", 5]);
      expect(sql).not.toContain("admin");
      await admins.toArray();
      expect(events.map((event) => ({ sql: event.sql, params: event.params }))).toEqual([
        { sql, params },
      ]);
    });
  });
});
