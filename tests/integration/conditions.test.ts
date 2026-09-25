import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { connect, Model, sql } from "../../src/index.ts";
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

  test("whereNot follows SQL semantics, so a NULL value is excluded too", async () => {
    const users = connect(binding).model(User);

    expect(await ids(users.whereNot({ role: "admin" }))).toEqual([2]);
  });

  test("whereNot negates the whole condition, not each attribute", async () => {
    const users = connect(binding).model(User);

    // NOT (role = 'admin' AND suspended = 1): only user 4 is a suspended admin.
    expect(await ids(users.whereNot({ role: "admin", suspended: true }))).toEqual([1, 2, 3]);
  });

  test("whereNot handles null, empty arrays, arrays with null, and sql fragments", async () => {
    const users = connect(binding).model(User);

    expect(await ids(users.whereNot({ role: null }))).toEqual([1, 2, 4]);
    expect(await ids(users.whereNot({ id: [] }))).toEqual([1, 2, 3, 4]);
    expect(await ids(users.whereNot({ role: ["member", null] }))).toEqual([1, 4]);
    expect(await ids(users.whereNot(sql`id < ${3}`))).toEqual([3, 4]);
  });

  test("where and whereNot combine with AND", async () => {
    const users = connect(binding).model(User);

    expect(await ids(users.where({ role: "admin" }).whereNot({ suspended: true }))).toEqual([1]);
  });
});
