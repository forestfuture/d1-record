import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { connect, Model } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

class User extends Model({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
}) {
  static tableName = "users";
}

describe("finding records", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.prepare("DELETE FROM users").run();
    await binding
      .prepare(
        `INSERT INTO users (id, email, role) VALUES
           (1, 'a@example.com', 'admin'),
           (2, 'b@example.com', 'member')`,
      )
      .run();
  });

  test("find returns the record with that primary key", async () => {
    const user = await connect(binding).model(User).find(2);

    expect(user).toBeInstanceOf(User);
    expect(user.email).toBe("b@example.com");
  });
});
