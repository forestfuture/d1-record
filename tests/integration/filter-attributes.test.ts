import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { connect, gte, Model, modelFor, type QueryEvent, sql } from "../../src/index.ts";
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

  test("conditions, lists and comparisons on a filtered attribute are hidden too", async () => {
    const users = db().model(User);

    await users.findBy({ email: "ada@example.com", role: "admin" });
    await users.where({ email: ["a@example.com", "b@example.com"] }).toArray();
    await users.where({ email: gte("m") }).count();

    // findBy's LIMIT 1 is the last value.
    expect(params()).toEqual([["[FILTERED]", "admin", 1], ["[FILTERED]"], ["[FILTERED]"]]);
  });

  test("a value in an sql fragment has no attribute, so it's shown as given", async () => {
    await db()
      .model(User)
      .where(sql`email = ${"ada@example.com"}`)
      .toArray();

    expect(params()).toEqual([["ada@example.com"]]);
  });

  describe("which attributes are filtered", () => {
    const named = (filterAttributes: readonly (string | RegExp)[]) =>
      class extends Model({
        id: { type: "integer", null: false },
        passwordDigest: "string",
        apiKey: "string",
        nickname: "string",
      }) {
        static override tableName = "accounts";
        static override filterAttributes = filterAttributes;
      };

    test("Rails' defaults match a camelCase attribute's snake_case name, in any case", async () => {
      expect(await hiddenNames(named(Model.Base.filterAttributes))).toEqual([
        "passwordDigest", // passw
        "apiKey", // _key, as api_key
      ]);
    });

    test("a RegExp matches the attribute or its snake_case name", async () => {
      expect(await hiddenNames(named([/^nick/]))).toEqual(["nickname"]);
      expect(await hiddenNames(named([/_digest$/]))).toEqual(["passwordDigest"]);
    });

    test("a list replaces the defaults, so [] filters nothing", async () => {
      expect(await hiddenNames(named(["NICK"]))).toEqual(["nickname"]);
      expect(await hiddenNames(named([]))).toEqual([]);
    });

    test("set on an app's base class, every Model built on it inherits it", async () => {
      class Base extends Model.Base {
        static override filterAttributes = [...Model.Base.filterAttributes, "nickname"];
      }
      const ApplicationRecord = modelFor(
        {
          accounts: {
            attributes: {
              id: "integer",
              passwordDigest: "string",
              apiKey: "string",
              nickname: "string",
            },
            primaryKey: "id",
          },
        } as const,
        Base,
      );

      expect(await hiddenNames(class extends ApplicationRecord("accounts") {})).toEqual([
        "passwordDigest",
        "apiKey",
        "nickname",
      ]);
    });

    /** The attributes whose value in a condition a listener sees as "[FILTERED]". */
    async function hiddenNames(model: object) {
      const hidden: string[] = [];
      for (const name of ["passwordDigest", "apiKey", "nickname"]) {
        const seen: QueryEvent[] = [];
        await connect(binding, { onQuery: (event) => seen.push(event) })
          .model(model as ReturnType<typeof named>) // any Model with these attributes
          .where({ [name]: "x" } as never)
          .toArray();
        if (seen[0]?.params[0] === "[FILTERED]") hidden.push(name);
      }
      return hidden;
    }
  });
});
