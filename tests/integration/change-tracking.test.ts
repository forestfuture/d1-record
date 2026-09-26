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

class ApiKey extends Model({
  id: { type: "string", null: false },
  label: { type: "string", null: false },
  scopes: "json",
  expiresAt: "datetime",
}) {
  static tableName = "api_keys";
}

describe("change tracking", () => {
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
      binding.prepare("INSERT INTO users (id, email, role) VALUES (1, 'a@example.com', 'member')"),
      binding.prepare(
        `INSERT INTO api_keys (id, label, scopes, expires_at)
         VALUES ('k1', 'deploy', '["read"]', '2026-01-01T00:00:00.000Z')`,
      ),
    ]);
  });

  test("a loaded record is clean; assigning reports what changed and from what", async () => {
    const user = await connect(binding).model(User).find(1);
    expect(user.isChanged()).toBe(false);

    user.role = "admin";

    expect(user.isChanged()).toBe(true);
    expect(user.changed()).toEqual(["role"]);
    expect(user.changedAttributes()).toEqual({ role: "member" });
    expect(user.changes()).toEqual({ role: ["member", "admin"] });
  });

  test("assigning the original value back is not a change", async () => {
    const user = await connect(binding).model(User).find(1);

    user.role = "admin";
    user.role = "member";

    expect(user.isChanged()).toBe(false);
  });

  test("in-place changes to json values and dates are detected", async () => {
    const key = await connect(binding).model(ApiKey).find("k1");

    (key.scopes as string[]).push("write");
    key.expiresAt?.setUTCFullYear(2030);

    expect(key.changed().sort()).toEqual(["expiresAt", "scopes"]);
    expect(key.changes()["scopes"]).toEqual([["read"], ["read", "write"]]);
  });

  test("a new record's changes are its assigned attributes", () => {
    const user = connect(binding).model(User).build({ email: "b@example.com" });

    expect(user.changed()).toEqual(["email"]);
    expect(user.changes()).toEqual({ email: [null, "b@example.com"] });
  });

  test("savedChanges holds the last save's changes, and the record is clean after saving", async () => {
    const user = await connect(binding).model(User).find(1);
    user.role = "admin";

    await user.save();

    expect(user.isChanged()).toBe(false);
    expect(user.savedChanges()).toEqual({ role: ["member", "admin"] });
    await user.save();
    expect(user.savedChanges()).toEqual({});
  });

  test("savedChanges holds copies, so editing the record afterwards doesn't change it", async () => {
    const key = await connect(binding).model(ApiKey).find("k1");
    key.scopes = ["read", "write"];
    await key.save();

    (key.scopes as string[]).push("admin");

    expect(key.savedChanges()).toEqual({ scopes: [["read"], ["read", "write"]] });
  });

  test("after create, savedChanges includes what D1 filled in, like the generated key", async () => {
    const user = await connect(binding).model(User).create({ email: "b@example.com" });

    expect(user.savedChanges()).toEqual({
      id: [null, user.id],
      email: [null, "b@example.com"],
    });
  });
});
