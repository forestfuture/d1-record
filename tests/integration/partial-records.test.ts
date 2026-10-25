import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { connect, MissingAttribute, Model } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
}) {
  static tableName = "users";
}

describe("partial records", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
    await binding
      .prepare("INSERT INTO users (id, email, role) VALUES (1, 'a@example.com', 'admin')")
      .run();
  });
  afterAll(() => dispose());

  test("select loads only the chosen attributes, plus the primary key", async () => {
    const [user] = await connect(binding).model(User).select("email").toArray();

    expect(user?.email).toBe("a@example.com");
    expect(user?.id).toBe(1);
    expect(user?.attributes()).toEqual({ id: 1, email: "a@example.com" });
  });

  test("reading an attribute that wasn't selected throws MissingAttribute", async () => {
    const [user] = await connect(binding).model(User).select("email").toArray();

    expect(() => user?.role).toThrow(MissingAttribute);
    expect(() => user?.role).toThrow(/User.*"role".*select/);
  });

  test("setting an unloaded attribute loads it", async () => {
    const [user] = await connect(binding).model(User).select("email").toArray();

    if (user) user.role = "member";

    expect(user?.role).toBe("member");
  });

  test("finders ignore select and load full records", async () => {
    const users = connect(binding).model(User).select("email");

    expect((await users.find(1)).role).toBe("admin");
    expect((await users.findBy({ id: 1 }))?.role).toBe("admin");
  });

  test("with distinct, only the selected attributes are loaded, so rows really are distinct", async () => {
    await binding
      .prepare("INSERT INTO users (id, email, role) VALUES (2, 'b@example.com', 'admin')")
      .run();
    const roles = connect(binding).model(User).select("role").distinct();

    const records = await roles.toArray();

    expect(records.map((record) => record.attributes())).toEqual([{ role: "admin" }]);
    expect(await roles.count()).toBe(records.length);
  });
});
