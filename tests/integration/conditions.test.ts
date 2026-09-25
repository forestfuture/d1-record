import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { connect, Model } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

class User extends Model({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
  suspended: { type: "boolean", null: false },
}) {
  static tableName = "users";
}

describe("conditions", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  const ids = async (relation: { toArray(): Promise<User[]> }) =>
    (await relation.toArray()).map((user) => user.id).sort((a, b) => a - b);

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
    await binding
      .prepare(
        `INSERT INTO users (id, email, role, suspended) VALUES
           (1, 'a@example.com', 'admin',  0),
           (2, 'b@example.com', 'member', 1),
           (3, 'c@example.com', NULL,     0),
           (4, 'd@example.com', 'admin',  1)`,
      )
      .run();
  });
  afterAll(() => dispose());

  test("an array value matches any of its values", async () => {
    const users = connect(binding).model(User);

    expect(await ids(users.where({ id: [1, 3, 99] }))).toEqual([1, 3]);
    expect(await ids(users.where({ role: ["admin", "member"] }))).toEqual([1, 2, 4]);
  });

  test("an empty array matches nothing", async () => {
    const users = connect(binding).model(User);

    expect(await ids(users.where({ id: [] }))).toEqual([]);
  });

  test("an array containing null also matches NULL", async () => {
    const users = connect(binding).model(User);

    expect(await ids(users.where({ role: ["member", null] }))).toEqual([2, 3]);
  });
});
