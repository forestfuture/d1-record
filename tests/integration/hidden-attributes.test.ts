import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { connect, Model } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

class User extends Model({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
}) {
  static tableName = "users";
  static hiddenAttributes = ["email"];
}

class Member extends Model({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
}) {
  static tableName = "users";
}

// What `toJSON()` leaves out of a record, so `Response.json(user)` can't leak it (#101).
describe("hiddenAttributes", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.prepare("DELETE FROM users").run();
  });

  test("a Model's toJSON leaves them out, and attributes() keeps them", async () => {
    const user = await connect(binding)
      .model(User)
      .create({ id: 1, email: "ada@example.com", role: "admin" });

    expect(user.toJSON()).toEqual({ id: 1, role: "admin" });
    expect(JSON.parse(JSON.stringify(user))).toEqual({ id: 1, role: "admin" });
    expect(user.attributes()).toEqual({ id: 1, email: "ada@example.com", role: "admin" });
  });

  test("none are hidden by default", async () => {
    const member = await connect(binding)
      .model(Member)
      .create({ id: 1, email: "ada@example.com", role: "admin" });

    expect(member.toJSON()).toEqual({ id: 1, email: "ada@example.com", role: "admin" });
  });

  test("a hidden attribute a partial record didn't load is no problem", async () => {
    await connect(binding).model(User).create({ id: 1, email: "ada@example.com", role: "admin" });
    const [user] = await connect(binding).model(User).select("id", "role").toArray();

    expect(user?.toJSON()).toEqual({ id: 1, role: "admin" });
  });
});
