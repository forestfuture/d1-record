import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { belongsTo, connect, hasMany, InvalidModel, Model } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

// Fresh Models used by no other test: Entry and Remark are only ever reached through includes.
class Owner extends Model.define({ id: { type: "integer", null: false }, email: "string" }) {
  static tableName = "users";
  entries = hasMany(Entry, { foreignKey: "userId" });
}

class Entry extends Model.define({
  id: { type: "integer", null: false },
  userId: "integer",
  title: "string",
}) {
  static tableName = "posts";
  owner = belongsTo(Owner, { foreignKey: "userId" });
  remarks = hasMany(Remark, { foreignKey: "postId" });
}

class Remark extends Model.define({
  id: { type: "integer", null: false },
  postId: "integer",
  body: "string",
}) {
  static tableName = "comments";
}

describe("Models reached only through includes", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
    await binding.batch([
      binding.prepare("INSERT INTO users (id, email) VALUES (1, 'a@example.com')"),
      binding.prepare("INSERT INTO posts (id, user_id, title) VALUES (10, 1, 'First')"),
      binding.prepare("INSERT INTO comments (id, post_id, body) VALUES (1, 10, 'Nice')"),
    ]);
  });
  afterAll(() => dispose());

  test("get their association methods, lazy and preloaded", async () => {
    const [owner] = await connect(binding).model(Owner).includes({ entries: "remarks" }).toArray();
    const [entry] = owner!.loaded("entries");

    expect((await entry!.owner())?.email).toBe("a@example.com");
    expect(entry!.loaded("remarks").map((remark) => remark.body)).toEqual(["Nice"]);
  });

  test("have their declarations checked", () => {
    class Broken extends Model.define({ id: "integer", userId: "integer" }) {
      static tableName = "posts";
      owner = belongsTo(Owner, { foreignKey: "ownerId" });
    }
    class Root extends Model.define({ id: "integer" }) {
      static tableName = "users";
      broken = hasMany(Broken, { foreignKey: "userId" });
    }

    expect(() => connect(binding).model(Root).includes("broken")).toThrow(InvalidModel);
  });
});
