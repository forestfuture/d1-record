import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { belongsTo, connect, hasMany, Model } from "../../src/index.ts";
import { Post } from "../fixtures/models/post.ts";
import { User } from "../fixtures/models/user.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

// The fixtures declare no foreignKey: User's hasMany and hasOne, and Post's belongsTo(User), all
// infer `userId` by Rails' convention.

// Named so their inferred keys (writerId, authorId) don't exist: the explicit ones must be used.
class Writer extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static table = "users";

  posts = hasMany(Article, { foreignKey: "userId" });
}

class Article extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static table = "posts";

  author = belongsTo(Writer, { foreignKey: "userId" });
}

describe("inferred foreign keys", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.batch([
      binding.prepare("DELETE FROM posts"),
      binding.prepare("DELETE FROM profiles"),
      binding.prepare("DELETE FROM users"),
      binding.prepare(
        "INSERT INTO users (id, email) VALUES (1, 'a@example.com'), (2, 'b@example.com')",
      ),
      binding.prepare("INSERT INTO posts (id, user_id, title) VALUES (10, 1, 'A'), (11, 2, 'B')"),
      binding.prepare("INSERT INTO profiles (id, user_id, bio) VALUES (1, 1, 'Ay')"),
    ]);
  });

  test("hasMany and hasOne infer the owner's class name + Id, as Rails does", async () => {
    const user = await connect(binding).model(User).find(1);

    expect(await user.posts().pluck("id")).toEqual([10]);
    expect((await user.profile())?.bio).toBe("Ay");
  });

  test("belongsTo infers the association's name + Id", async () => {
    const post = await connect(binding).model(Post).find(11);

    expect((await post.user())?.email).toBe("b@example.com");
  });

  test("an explicit foreignKey wins over the inferred one", async () => {
    const db = connect(binding);
    const writer = await db.model(Writer).find(1);
    const article = await db.model(Article).find(11);

    expect(await writer.posts().pluck("id")).toEqual([10]);
    expect((await article.author())?.email).toBe("b@example.com");
  });

  test("a subclass has its parent's associations, and redeclaring one replaces it", async () => {
    class Guest extends User {}
    class Editor extends User {
      posts = hasMany(Post, { scope: (q) => q.where({ title: "C" }) });
    }
    const db = connect(binding);
    await db.model(Post).insert({ id: 12, userId: 1, title: "C" });

    const inherited = await db
      .model(Guest)
      .find(1)
      .then((user) => user.posts().pluck("title"));
    const replaced = await db
      .model(Editor)
      .find(1)
      .then((user) => user.posts().pluck("title"));

    expect(inherited).toEqual(["A", "C"]);
    expect(replaced).toEqual(["C"]);
  });

  test("a subclass's hasMany infers its key from the Model's class, as its table name does", async () => {
    class Admin extends User {
      notes = hasMany(Post); // userId, from User; Post has no adminId
    }

    const admin = await connect(binding).model(Admin).find(2);

    expect(await admin.notes().pluck("title")).toEqual(["B"]);
  });

  test("an inferred key is used for building, preloading and autosave alike", async () => {
    const db = connect(binding);
    const [user] = await db.model(User).where({ id: 2 }).includes("posts").toArray();
    const built = user!.posts().build({ title: "C" });
    await user!.saveOrThrow();

    expect((await user!.posts().toArray()).map((post) => post.title)).toEqual(["B", "C"]);
    expect(built.userId).toBe(2);
  });
});
