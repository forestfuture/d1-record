import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { connect, Model } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

class User extends Model({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static tableName = "users";
}

describe("reading records", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.prepare("DELETE FROM users").run();
  });

  test("toArray returns every row as a record of its model", async () => {
    await binding
      .prepare("INSERT INTO users (id, email) VALUES (1, 'a@example.com'), (2, 'b@example.com')")
      .run();
    const db = connect(binding);

    const users = await db.model(User).toArray();

    expect(users.every((user) => user instanceof User)).toBe(true);
    const byId = users.toSorted((a, b) => a.id - b.id);
    expect(byId.map((user) => [user.id, user.email])).toEqual([
      [1, "a@example.com"],
      [2, "b@example.com"],
    ]);
  });
});
