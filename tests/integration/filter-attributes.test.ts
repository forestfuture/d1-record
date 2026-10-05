import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { connect, Model, type QueryEvent } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

class User extends Model({
  id: { type: "integer", null: false },
  email: { type: "string", null: false }, // filtered by default: "email"
  role: "string",
}) {
  static tableName = "users";
}

// What onQuery listeners see of a filtered attribute's values: "[FILTERED]", as in Rails' logs.
// D1 still gets the real values (#83).
describe("filterAttributes", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  let events: QueryEvent[];
  const db = () => connect(binding, { onQuery: (event) => events.push(event) });
  const params = () => events.map((event) => event.params);

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.prepare("DELETE FROM users").run();
    events = [];
  });

  test("an insert's and an update's values for a filtered attribute are hidden from listeners", async () => {
    const user = await db().model(User).create({ id: 1, email: "ada@example.com", role: "admin" });
    await user.update({ email: "ada@lovelace.dev", role: "owner" });

    expect(params()).toEqual([
      [1, "[FILTERED]", "admin"],
      ["[FILTERED]", "owner", 1],
    ]);
    expect(await binding.prepare("SELECT email FROM users").first("email")).toBe(
      "ada@lovelace.dev",
    );
  });

  test("a multi-row insert hides a filtered attribute's values in its JSON", async () => {
    await db()
      .model(User)
      .insertAll([
        { id: 1, email: "ada@example.com", role: "admin" },
        { id: 2, email: "grace@example.com", role: null },
      ]);

    expect(params()).toEqual([
      [
        JSON.stringify([
          [1, "[FILTERED]", "admin"],
          [2, "[FILTERED]", null],
        ]),
      ],
    ]);
    expect(await db().model(User).pluck("email")).toEqual(["ada@example.com", "grace@example.com"]);
  });

  test("updateAll hides a filtered attribute's new value", async () => {
    await db().model(User).insert({ id: 1, email: "ada@example.com" });
    events = [];

    await db().model(User).updateAll({ email: "x@example.com", role: "admin" });

    expect(params()).toEqual([["[FILTERED]", "admin"]]);
  });
});
