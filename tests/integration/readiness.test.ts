import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { belongsTo, connect, hasMany, InvalidModel, Model } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

// Reached only through Post's association: never queried or modelled directly.
class Comment extends Model({
  id: { type: "integer", null: false },
  postId: "integer",
  body: "string",
}) {
  static tableName = "comments";

  post = belongsTo(Post, { foreignKey: "postId" });
}

class Post extends Model({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static tableName = "posts";

  comments = hasMany(Comment, { foreignKey: "postId" });
}

// Its target names a primary key that isn't an attribute: invalid, found at first use.
class Broken extends Model({ id: { type: "integer", null: false } }) {
  static tableName = "comments";
  static override primaryKey = "missing";
}

class Pointing extends Model({ id: { type: "integer", null: false }, postId: "integer" }) {
  static tableName = "comments";

  broken = belongsTo(Broken, { foreignKey: "postId" });
}

// A Model is made ready (verified, its associations' accessors installed, its declarations
// sealed) the first time anything uses it, however it's reached: a query, a preload or an
// association (ADR-0008, "Ready at first use, wherever that is").
describe("a Model is ready however it's first reached", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
    await binding.batch([
      binding.prepare("INSERT INTO users (id, email) VALUES (1, 'ada@example.com')"),
      binding.prepare("INSERT INTO posts (id, user_id, title) VALUES (10, 1, 'Hello')"),
      binding.prepare("INSERT INTO comments (id, post_id, body) VALUES (100, 10, 'Hm.')"),
    ]);
  });
  afterAll(() => dispose());

  test("a Model reached only through an association has its own association accessors", async () => {
    const post = await connect(binding).model(Post).find(10);
    const [comment] = await post.comments().toArray();

    expect((await comment!.post())?.title).toBe("Hello");
  });

  test("so does one reached only through a preload", async () => {
    const [post] = await connect(binding).model(Post).includes("comments").toArray();

    expect((await post!.loaded("comments")[0]!.post())?.id).toBe(10);
  });

  test("an association's invalid target is refused when its owner is first used", () => {
    expect(() => connect(binding).model(Pointing)).toThrow(
      new InvalidModel(
        'Pointing association "broken": Broken has no attribute "missing" (check primaryKey)',
      ),
    );
    expect(() => connect(binding).model(Broken)).toThrow(InvalidModel);
  });

  test("declaring on a Model after it's been used through an association is refused", () => {
    expect(() => Comment.validates("body", { presence: true })).toThrow(InvalidModel);
  });
});
