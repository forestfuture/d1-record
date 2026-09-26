import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { connect, Model, type QueryEvent } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

class User extends Model({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
  isActive: "boolean",
}) {
  static tableName = "users";
}

let counter = 0;

class ApiKey extends Model({
  id: { type: "string", null: false, default: () => `key-${++counter}` },
  label: { type: "string", null: false },
  scopes: "json",
  expiresAt: "datetime",
}) {
  static tableName = "api_keys";
}

describe("record lifecycle", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.batch([
      binding.prepare("DELETE FROM users"),
      binding.prepare("DELETE FROM api_keys"),
    ]);
  });

  test("build makes a new, unsaved record without querying, and evaluates defaults", () => {
    const queries: QueryEvent[] = [];
    const db = connect(binding, { onQuery: (event) => queries.push(event) });

    const user = db.model(User).build({ email: "a@example.com" });
    const key = db.model(ApiKey).build({ label: "deploy" });

    expect(user).toBeInstanceOf(User);
    expect(user.isNewRecord()).toBe(true);
    expect(user.isPersisted()).toBe(false);
    expect(user.email).toBe("a@example.com");
    expect(user.role).toBeNull();
    expect(key.id).toMatch(/^key-\d+$/);
    expect(queries).toHaveLength(0);
  });

  test("saving a new record inserts it; the database fills in its key and column defaults", async () => {
    const users = connect(binding).model(User);
    const user = users.build({ email: "a@example.com" });

    expect(await user.save()).toBe(true);

    expect(user.isPersisted()).toBe(true);
    expect(user.isNewRecord()).toBe(false);
    expect(user.id).toBeTypeOf("number");
    expect(user.isActive).toBe(true); // column default, because isActive wasn't assigned
    expect((await users.find(user.id)).email).toBe("a@example.com");
  });

  test("an app-generated key from a default is inserted as given", async () => {
    const keys = connect(binding).model(ApiKey);
    const key = keys.build({ label: "deploy", scopes: ["read"] });
    const id = key.id;

    await key.save();

    expect(key.id).toBe(id);
    expect((await keys.find(id)).scopes).toEqual(["read"]);
  });

  test("create and createOrThrow build and save in one step, resolving to the record", async () => {
    const users = connect(binding).model(User);

    const created = await users.create({ email: "a@example.com", role: "admin" });
    const createdOrThrow = await users.createOrThrow({ email: "b@example.com" });

    expect(created).toBeInstanceOf(User);
    expect(created.isPersisted()).toBe(true);
    expect(createdOrThrow.isPersisted()).toBe(true);
    expect(await users.order({ id: "asc" }).pluck("email")).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
  });

  test("saving a loaded record updates only its changed columns", async () => {
    await connect(binding).model(User).create({ email: "a@example.com", role: "member" });
    const queries: QueryEvent[] = [];
    const users = connect(binding, { onQuery: (event) => queries.push(event) }).model(User);
    const user = await users.findByOrThrow({ email: "a@example.com" });
    queries.length = 0;

    user.role = "admin";
    expect(await user.save()).toBe(true);

    expect(queries).toHaveLength(1);
    expect(queries[0]?.sql).toMatch(/^UPDATE "users" SET "role" = \?/);
    expect(queries[0]?.sql).not.toContain('"email"');
    expect((await users.find(user.id)).role).toBe("admin");
  });

  test("saving a record with no changes sends no statement", async () => {
    await connect(binding).model(User).create({ email: "a@example.com" });
    const queries: QueryEvent[] = [];
    const users = connect(binding, { onQuery: (event) => queries.push(event) }).model(User);
    const user = await users.findByOrThrow({ email: "a@example.com" });
    queries.length = 0;

    user.email = "a@example.com"; // assigned, but unchanged

    expect(await user.save()).toBe(true);
    expect(queries).toHaveLength(0);
  });
});
