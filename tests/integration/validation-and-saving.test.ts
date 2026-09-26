import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { connect, D1RecordError, Model, RecordInvalid, type QueryEvent } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

class User extends Model({
  id: { type: "integer", null: false },
  email: "string",
  role: "string",
}) {
  static tableName = "users";

  static {
    this.validates("email", { presence: true });
  }
}

describe("validation when saving", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.prepare("DELETE FROM users").run();
  });

  test("saving an invalid record returns false and sends no statement", async () => {
    const queries: QueryEvent[] = [];
    const user = connect(binding, { onQuery: (event) => queries.push(event) })
      .model(User)
      .build({ role: "admin" });

    expect(await user.save()).toBe(false);

    expect(queries).toHaveLength(0);
    expect(user.isNewRecord()).toBe(true);
    expect(user.errors.get("email")).toEqual(["can't be blank"]);
    expect(user.changes()).toEqual({ role: [null, "admin"] });
  });

  test("saveOrThrow and createOrThrow throw RecordInvalid carrying the record", async () => {
    const users = connect(binding).model(User);
    const user = users.build();

    const error = await user.saveOrThrow().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RecordInvalid);
    expect(error).toBeInstanceOf(D1RecordError);
    expect((error as RecordInvalid).record).toBe(user);
    expect((error as Error).message).toMatch(/Email can't be blank/);
    await expect(users.createOrThrow({})).rejects.toThrow(RecordInvalid);
  });

  test("create returns an invalid record unsaved, with its errors", async () => {
    const users = connect(binding).model(User);

    const user = await users.create({ role: "admin" });

    expect(user.isNewRecord()).toBe(true);
    expect(user.errors.size).toBe(1);
    expect(await users.count()).toBe(0);
  });

  test("an invalid update returns false, writes nothing and keeps the changes", async () => {
    const users = connect(binding).model(User);
    const user = await users.create({ email: "a@example.com" });

    expect(await user.update({ email: " " })).toBe(false);

    expect(user.changes()).toEqual({ email: ["a@example.com", " "] });
    expect((await users.find(user.id)).email).toBe("a@example.com");
  });
});
