import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { belongsTo, connect, hasMany, hasOne, Model, type QueryEvent } from "../../src/index.ts";
import { createTestDatabase, recordingBatches, type TestDatabase } from "../support/d1.ts";

class User extends Model({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static tableName = "users";

  posts = hasMany(Post, { foreignKey: "userId" });
  profile = hasOne(Profile, { foreignKey: "userId" });
}

class Post extends Model({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static tableName = "posts";

  comments = hasMany(Comment, { foreignKey: "postId" });
}

class Comment extends Model({
  id: { type: "integer", null: false },
  postId: "integer",
  body: "string",
}) {
  static tableName = "comments";
}

class Profile extends Model({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  bio: "string",
}) {
  static tableName = "profiles";

  user = belongsTo(User, { foreignKey: "userId" });
}

class Account extends Model({
  id: { type: "integer", null: false },
  userId: "integer",
}) {
  static tableName = "accounts";

  user = belongsTo(User, { foreignKey: "userId" });
}

// Each level of an includes tree is one round trip: its associations go to D1 together.
describe("preloading sends each level's associations together", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  let batches: number[] = [];
  const queries: QueryEvent[] = [];
  const db = () => {
    const recording = recordingBatches(binding);
    batches = recording.batches;
    return connect(recording.binding, { onQuery: (event) => queries.push(event) });
  };
  const titles = (user: User) => user.loaded("posts").map((post) => post.title);

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    queries.length = 0;
    await binding.batch([
      binding.prepare("DELETE FROM accounts"),
      binding.prepare("DELETE FROM comments"),
      binding.prepare("DELETE FROM posts"),
      binding.prepare("DELETE FROM profiles"),
      binding.prepare("DELETE FROM users"),
      binding.prepare(
        "INSERT INTO users (id, email) VALUES (1, 'a@example.com'), (2, 'b@example.com'), (3, 'c@example.com')",
      ),
      binding.prepare(
        "INSERT INTO posts (id, user_id, title) VALUES (11, 1, 'A2'), (10, 1, 'A1'), (12, 2, 'B1')",
      ),
      binding.prepare("INSERT INTO profiles (id, user_id, bio) VALUES (1, 2, 'Bee')"),
    ]);
  });

  test("two associations: the records' query, then one batch of both", async () => {
    const users = await db()
      .model(User)
      .includes("posts", "profile")
      .order({ id: "asc" })
      .toArray();

    expect(batches).toEqual([2]);
    expect(queries).toHaveLength(3);
    expect(users.map(titles)).toEqual([["A1", "A2"], ["B1"], []]);
    expect(users.map((user) => user.loaded("profile")?.bio ?? null)).toEqual([null, "Bee", null]);
  });

  test("one association is one query, not a batch", async () => {
    const users = await db().model(User).includes("posts").order({ id: "asc" }).toArray();

    expect(batches).toEqual([]);
    expect(queries).toHaveLength(2);
    expect(users.map(titles)).toEqual([["A1", "A2"], ["B1"], []]);
  });

  test("an association with no keys to look up sends nothing", async () => {
    await binding.prepare("INSERT INTO accounts (id, user_id) VALUES (1, NULL)").run();

    const [account] = await db().model(Account).includes("user").toArray();

    expect(account?.loaded("user")).toBeNull();
    expect(batches).toEqual([]);
    expect(queries).toHaveLength(1);
  });

  test("a level with only one association to load sends it on its own", async () => {
    // User 1 has posts but no profile, so the second level reads only the posts' comments.
    const [user] = await db()
      .model(User)
      .includes({ posts: "comments", profile: "user" })
      .where({ id: 1 })
      .toArray();

    expect(user?.loaded("profile")).toBeNull();
    expect(user?.loaded("posts").map((post) => post.loaded("comments"))).toEqual([[], []]);
    expect(batches).toEqual([2]);
    expect(queries).toHaveLength(4);
  });

  test("nested associations in different branches go together, one batch per level", async () => {
    await binding.prepare("INSERT INTO comments (id, post_id, body) VALUES (1, 12, 'Hm')").run();

    const [user] = await db()
      .model(User)
      .includes({ posts: "comments", profile: "user" })
      .where({ id: 2 })
      .toArray();

    expect(batches).toEqual([2, 2]);
    expect(queries).toHaveLength(5);
    const [post] = user!.loaded("posts");
    expect(post?.loaded("comments").map((comment) => comment.body)).toEqual(["Hm"]);
    expect(user?.loaded("profile")?.loaded("user")?.email).toBe("b@example.com");
  });
});
