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

  test("findBy returns the matching record, or null when there isn't one", async () => {
    const users = connect(binding).model(User);

    const found = await users.findBy({ email: "a@example.com" });
    const missing = await users.findBy({ email: "nobody@example.com" });

    expect(found?.id).toBe(1);
    expect(missing).toBeNull();
  });

  test("findByOrThrow returns the matching record, or throws RecordNotFound", async () => {
    const users = connect(binding).model(User);

    await expect(users.findByOrThrow({ role: "member" })).resolves.toMatchObject({ id: 2 });
    await expect(users.findByOrThrow({ role: "owner" })).rejects.toThrow(RecordNotFound);
  });

  test("finders ignore the relation's order, limit and offset", async () => {
    const paged = connect(binding).model(User).order({ id: "asc" }).limit(1).offset(10);

    await expect(paged.find(2)).resolves.toMatchObject({ id: 2 });
    await expect(paged.findBy({ role: "member" })).resolves.toMatchObject({ id: 2 });
  });
});
