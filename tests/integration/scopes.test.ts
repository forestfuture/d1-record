import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { connect, Model, sql } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

class User extends Model({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
  isActive: "boolean",
  createdAt: "datetime",
}) {
  static tableName = "users";

  static scopes = this.defineScopes({
    active: (q) => q.where({ isActive: true }),
    recent: (q) => q.order({ createdAt: "desc" }),
    createdAfter: (q, since: Date) => q.where(sql`created_at > ${since}`),
  });
}

describe("scopes", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  const ids = (users: User[]) => users.map((user) => user.id);

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
    await binding
      .prepare(
        `INSERT INTO users (id, email, role, is_active, created_at) VALUES
           (1, 'a@example.com', 'admin',  1, '2026-01-01T00:00:00.000Z'),
           (2, 'b@example.com', 'member', 1, '2026-03-01T00:00:00.000Z'),
           (3, 'c@example.com', 'admin',  0, '2026-04-01T00:00:00.000Z'),
           (4, 'd@example.com', 'admin',  1, '2026-05-01T00:00:00.000Z')`,
      )
      .run();
  });
  afterAll(() => dispose());

  test("scopes are callable on the model and after any chained call, and compose", async () => {
    const users = connect(binding).model(User);

    const activeRecent = await users.active().recent().toArray();
    const adminsAfter = await users
      .where({ role: "admin" })
      .active()
      .createdAfter(new Date(Date.UTC(2026, 1, 1)))
      .toArray();

    expect(ids(activeRecent)).toEqual([4, 2, 1]);
    expect(ids(adminsAfter)).toEqual([4]);
  });
});
