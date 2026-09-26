import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  connect,
  Model,
  sql,
  RecordDestroyed,
  RecordNotFound,
  UnknownAttribute,
  type QueryEvent,
} from "../../src/index.ts";
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

  test("assign sets several attributes without saving, rejecting unknown keys and undefined", async () => {
    const queries: QueryEvent[] = [];
    const users = connect(binding, { onQuery: (event) => queries.push(event) }).model(User);
    const user = users.build({ email: "a@example.com" });

    user.assign({ role: "admin", isActive: false });

    expect(user.changes()).toMatchObject({ role: [null, "admin"], isActive: [null, false] });
    expect(queries).toHaveLength(0);
    // @ts-expect-error unknown attribute
    expect(() => user.assign({ nope: 1 })).toThrow(UnknownAttribute);
    expect(() => user.assign({ role: undefined })).toThrow(/"role".*null/);
    expect(() => users.build({ role: undefined })).toThrow(TypeError);
  });

  test("update and updateOrThrow assign and save in one step", async () => {
    const users = connect(binding).model(User);
    const user = await users.create({ email: "a@example.com", role: "member" });

    expect(await user.update({ role: "admin" })).toBe(true);
    expect(await user.updateOrThrow({ isActive: false })).toBe(true);

    const stored = await users.find(user.id);
    expect([stored.role, stored.isActive]).toEqual(["admin", false]);
  });

  test("reload discards unsaved changes and loads the stored row", async () => {
    const users = connect(binding).model(User);
    const user = await users.create({ email: "a@example.com", role: "member" });
    await binding.prepare("UPDATE users SET role = 'owner' WHERE id = ?").bind(user.id).run();
    user.email = "changed@example.com";

    await user.reload();

    expect(user.email).toBe("a@example.com");
    expect(user.role).toBe("owner");
    expect(user.isChanged()).toBe(false);
  });

  test("reload throws RecordNotFound when the row is gone", async () => {
    const user = await connect(binding).model(User).create({ email: "a@example.com" });
    await binding.prepare("DELETE FROM users").run();

    await expect(user.reload()).rejects.toThrow(RecordNotFound);
  });

  test("building from a relation inherits its single equality values; explicit ones win", async () => {
    const users = connect(binding).model(User);
    const admins = users
      .where({ role: "admin", id: [1, 2] })
      .whereNot({ email: "x@example.com" })
      .where(sql`email LIKE ${"%@example.com"}`);

    const built = admins.build({ email: "a@example.com" });
    const overridden = admins.build({ email: "b@example.com", role: "member" });
    const created = await admins.create({ email: "c@example.com" });

    expect(built.changes()).toEqual({ email: [null, "a@example.com"], role: [null, "admin"] });
    expect(overridden.role).toBe("member");
    expect((await users.find(created.id)).role).toBe("admin");
  });

  test("destroy deletes the row; the record stays readable as a destroyed snapshot", async () => {
    const users = connect(binding).model(User);
    const user = await users.create({ email: "a@example.com" });

    expect(await user.destroy()).toBe(user);

    expect(user.isDestroyed()).toBe(true);
    expect(user.isPersisted()).toBe(false);
    expect(user.email).toBe("a@example.com");
    expect(await users.exists({ id: user.id })).toBe(false);
  });

  test("destroyOrThrow resolves to the record, and a row that's already gone still counts", async () => {
    const user = await connect(binding).model(User).create({ email: "a@example.com" });
    await binding.prepare("DELETE FROM users").run();

    expect(await user.destroyOrThrow()).toBe(user);
    expect(user.isDestroyed()).toBe(true);
  });

  test("using a destroyed record as a live one throws RecordDestroyed", async () => {
    const user = await connect(binding).model(User).create({ email: "a@example.com" });
    await user.destroy();

    await expect(user.save()).rejects.toThrow(RecordDestroyed);
    await expect(user.saveOrThrow()).rejects.toThrow(RecordDestroyed);
    await expect(user.update({ role: "admin" })).rejects.toThrow(RecordDestroyed);
    await expect(user.destroy()).rejects.toThrow(RecordDestroyed);
    await expect(user.reload()).rejects.toThrow(/User.*destroyed/);
  });
});
