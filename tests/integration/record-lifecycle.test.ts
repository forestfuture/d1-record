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
});
