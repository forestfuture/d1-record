import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { connect, hasMany, Model, UnknownAssociation, UnknownAttribute } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

class Post extends Model({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static tableName = "posts";
}

class User extends Model({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static tableName = "users";

  posts = hasMany(Post, { foreignKey: "userId" });
}

// Names an app might take from a URL (`?include=`), and that every JavaScript object inherits:
// each is an unknown name, never one of Object's own members (#84).
const inherited = ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"];

describe("a name that every object inherits isn't an attribute or association", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  let user: User;
  const users = () => connect(binding).model(User);

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
    user = await users().create({ id: 1, email: "ada@example.com" });
    await user.update({ email: "ada@lovelace.dev" });
  });
  afterAll(() => dispose());

  // includes checks its names when it's called, as for any name that isn't an association.
  test.each(inherited)("includes(%j) is UnknownAssociation", (name) => {
    expect(() => users().includes(name as never)).toThrow(UnknownAssociation);
  });

  test.each(inherited)(
    "reloadAssociation, loaded and isLoaded(%j) are UnknownAssociation",
    async (name) => {
      await expect(user.reloadAssociation(name as never)).rejects.toThrow(UnknownAssociation);
      expect(() => user.loaded(name as never)).toThrow(UnknownAssociation);
      expect(() => user.isLoaded(name as never)).toThrow(UnknownAssociation);
    },
  );

  test.each(inherited)("the change-tracking methods with %j are UnknownAttribute", (name) => {
    const unknown = name as never;
    expect(() => user.attributeWas(unknown)).toThrow(UnknownAttribute);
    expect(() => user.isAttributeChanged(unknown)).toThrow(UnknownAttribute);
    expect(() => user.willSaveChangeTo(unknown)).toThrow(UnknownAttribute);
    expect(() => user.savedChangeTo(unknown)).toThrow(UnknownAttribute);
    expect(() => user.hasSavedChangeTo(unknown)).toThrow(UnknownAttribute);
    expect(() => user.attributeBeforeLastSave(unknown)).toThrow(UnknownAttribute);
    expect(() => user.restoreAttributes([unknown])).toThrow(UnknownAttribute);
  });

  test("the real names still work", async () => {
    expect(user.savedChangeTo("email")).toEqual(["ada@example.com", "ada@lovelace.dev"]);
    expect(await user.reloadAssociation("posts")).toEqual([]);
  });
});
