import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { connect, Model } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

class User extends Model({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
  createdAt: "datetime",
}) {
  static tableName = "users";
}

const ids = (users: User[]) => users.map((user) => user.id);

describe("ordering and pagination", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
    await binding
      .prepare(
        `INSERT INTO users (id, email, role, created_at) VALUES
           (1, 'a@example.com', 'member', '2026-03-01T00:00:00.000Z'),
           (2, 'b@example.com', 'admin',  '2026-01-01T00:00:00.000Z'),
           (3, 'c@example.com', 'member', '2026-02-01T00:00:00.000Z'),
           (4, 'd@example.com', 'admin',  '2026-04-01T00:00:00.000Z')`,
      )
      .run();
  });
  afterAll(() => dispose());

  test("order sorts by each key in turn, and repeated calls append", async () => {
    const users = connect(binding).model(User);

    const newestFirst = await users.order({ createdAt: "desc" }).toArray();
    const byRoleThenId = await users.order({ role: "asc", id: "desc" }).toArray();
    const appended = await users.order({ role: "asc" }).order({ createdAt: "asc" }).toArray();

    expect(ids(newestFirst)).toEqual([4, 1, 3, 2]);
    expect(ids(byRoleThenId)).toEqual([4, 2, 3, 1]);
    expect(ids(appended)).toEqual([2, 4, 3, 1]);
  });
});
