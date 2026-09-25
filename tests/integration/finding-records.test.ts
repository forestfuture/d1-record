import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { connect, D1RecordError, Model, RecordNotFound } from "../../src/index.ts";
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

  test("find throws RecordNotFound when no row has that primary key", async () => {
    const lookup = connect(binding).model(User).find(99);

    await expect(lookup).rejects.toThrow(RecordNotFound);
    await expect(lookup).rejects.toThrow(D1RecordError);
    await expect(lookup).rejects.toThrow(/User.*99/);
  });

  test("find keeps the relation's conditions, so an excluded row isn't found", async () => {
    const admins = connect(binding).model(User).where({ role: "admin" });

    await expect(admins.find(1)).resolves.toBeInstanceOf(User);
    await expect(admins.find(2)).rejects.toThrow(RecordNotFound);
  });
});
