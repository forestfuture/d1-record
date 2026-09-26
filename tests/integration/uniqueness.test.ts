import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { connect, MissingAttribute, Model, type QueryEvent } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

// The accounts table has no UNIQUE constraints, so only the validation can reject duplicates.
class Account extends Model({
  id: { type: "integer", null: false },
  externalAccountId: "string",
  userID: "integer",
  htmlURL: "string",
}) {
  static tableName = "accounts";

  static {
    this.validates("externalAccountId", { uniqueness: { scope: ["userID"] } });
    this.validates("htmlURL", { uniqueness: { caseSensitive: false } });
  }
}

describe("uniqueness validation", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.prepare("DELETE FROM accounts").run();
  });

  test("a value another row already has is taken, within the scope", async () => {
    const accounts = connect(binding).model(Account);
    await accounts.create({ externalAccountId: "e1", userID: 1 });

    const sameUser = accounts.build({ externalAccountId: "e1", userID: 1 });
    const otherUser = accounts.build({ externalAccountId: "e1", userID: 2 });

    expect(await sameUser.isValid()).toBe(false);
    expect(sameUser.errors.toArray()).toEqual([
      { attribute: "externalAccountId", type: "taken", message: "has already been taken" },
    ]);
    expect(await otherUser.isValid()).toBe(true);
  });

  test("a saved record doesn't count as a duplicate of itself", async () => {
    const account = await connect(binding)
      .model(Account)
      .create({ externalAccountId: "e1", userID: 1 });

    account.htmlURL = "https://example.com";

    expect(await account.save()).toBe(true);
  });

  test("null is never taken, matching SQLite's UNIQUE", async () => {
    const accounts = connect(binding).model(Account);
    await accounts.create({ externalAccountId: "e1", userID: 1 });

    expect(await accounts.build({ externalAccountId: "e2", userID: 1 }).isValid()).toBe(true);
  });

  test("caseSensitive: false compares lowercased values", async () => {
    const accounts = connect(binding).model(Account);
    await accounts.create({ externalAccountId: "e1", htmlURL: "https://Example.com" });

    const shouted = accounts.build({ externalAccountId: "e2", htmlURL: "HTTPS://EXAMPLE.COM" });

    expect(await shouted.isValid()).toBe(false);
    expect(shouted.errors.get("htmlURL")).toEqual(["has already been taken"]);
  });

  test("the check runs through the record's own Database", async () => {
    const queries: QueryEvent[] = [];
    const accounts = connect(binding, { onQuery: (event) => queries.push(event) }).model(Account);

    await accounts.build({ externalAccountId: "e1" }).isValid();

    expect(queries.map((query) => query.sql)).toEqual([
      expect.stringMatching(/^SELECT 1 FROM "accounts"/),
    ]);
  });

  test("a keyless record can't be checked for uniqueness: it can't leave itself out", async () => {
    const accounts = connect(binding).model(Account);
    await accounts.create({ externalAccountId: "e1", userID: 1 });
    // Every validated attribute is loaded, so only the uniqueness check can fail.
    const [keyless] = await accounts
      .select("externalAccountId", "userID", "htmlURL")
      .distinct()
      .toArray();
    if (!keyless) throw new Error("expected a record");

    await expect(keyless.isValid()).rejects.toThrow(MissingAttribute);
    await expect(keyless.isValid()).rejects.toThrow(/primary key/);
  });
});
