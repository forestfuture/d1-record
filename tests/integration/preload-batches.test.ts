import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  belongsTo,
  connect,
  hasMany,
  hasOne,
  type HasMany,
  IncompatibleRelation,
  InvalidModel,
  Model,
  type QueryEvent,
} from "../../src/index.ts";
import { createTestDatabase, recordingBatches, type TestDatabase } from "../support/d1.ts";

class User extends Model({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static tableName = "users";

  posts = hasMany(Post, { foreignKey: "userId" });
  profile = hasOne(Profile, { foreignKey: "userId" });
  postsWithComments = hasMany(Post, {
    foreignKey: "userId",
    scope: (q) => q.includes("comments"),
  });
  noPosts = hasMany(Post, { foreignKey: "userId", scope: (q) => q.none() });
  postsByTitle = hasMany(Post, { foreignKey: "userId", scope: (q) => q.order({ title: "desc" }) });
  postTitles = hasMany(Post, { foreignKey: "userId", scope: (q) => q.select("title") });
  ghosts = hasMany(Ghost, { foreignKey: "userId" });
}

class Post extends Model({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static tableName = "posts";

  author = belongsTo(User, { foreignKey: "userId" });
  comments = hasMany(Comment, { foreignKey: "postId" });
  firstComment = hasMany(Comment, { foreignKey: "postId", scope: (q) => q.limit(1) });
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

// Its table, inferred as "ghosts", doesn't exist.
class Ghost extends Model({
  id: { type: "integer", null: false },
  userId: "integer",
}) {}

class Account extends Model({
  id: { type: "integer", null: false },
  userId: "integer",
}) {
  static tableName = "accounts";

  user = belongsTo(User, { foreignKey: "userId" });
  // A tree of accounts, user_id holding the parent's id: each preloads its own children.
  // Annotated, since the scope names the association it declares.
  children: HasMany<typeof Account> = hasMany(Account, {
    foreignKey: "userId",
    scope: (q) => q.includes("children"),
  });
}

// Each level of an includes tree is one round trip: its associations go to D1 together.
describe("preloading sends each level's associations together", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  // Made afresh for each test, so its batches are that test's.
  let recording: ReturnType<typeof recordingBatches>;
  const queries: QueryEvent[] = [];
  const db = () => connect(recording.binding, { onQuery: (event) => queries.push(event) });
  const titles = (user: User) => user.loaded("posts").map((post) => post.title);

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    recording = recordingBatches(binding);
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

    expect(recording.batches).toEqual([2]);
    expect(queries).toHaveLength(3);
    expect(users.map(titles)).toEqual([["A1", "A2"], ["B1"], []]);
    expect(users.map((user) => user.loaded("profile")?.bio ?? null)).toEqual([null, "Bee", null]);
  });

  test("one association is one query, not a batch", async () => {
    const users = await db().model(User).includes("posts").order({ id: "asc" }).toArray();

    expect(recording.batches).toEqual([]);
    expect(queries).toHaveLength(2);
    expect(users.map(titles)).toEqual([["A1", "A2"], ["B1"], []]);
  });

  test("an association with no keys to look up sends nothing", async () => {
    await binding.prepare("INSERT INTO accounts (id, user_id) VALUES (1, NULL)").run();

    const [account] = await db().model(Account).includes("user").toArray();

    expect(account?.loaded("user")).toBeNull();
    expect(recording.batches).toEqual([]);
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
    expect(recording.batches).toEqual([2]);
    expect(queries).toHaveLength(4);
  });

  test("a hasMany preloaded in a batch keeps its scope's order", async () => {
    const [user] = await db()
      .model(User)
      .includes("postsByTitle", "profile")
      .where({ id: 1 })
      .toArray();

    expect(user?.loaded("postsByTitle").map((post) => post.title)).toEqual(["A2", "A1"]);
    expect(recording.batches).toEqual([2]);
  });

  test("a nested level whose branches all found nothing sends nothing", async () => {
    // User 3 has no posts and no profile, so neither comments nor a profile's user is looked up.
    const [user] = await db()
      .model(User)
      .includes({ posts: "comments", profile: "user" })
      .where({ id: 3 })
      .toArray();

    expect(user?.loaded("posts")).toEqual([]);
    expect(user?.loaded("profile")).toBeNull();
    expect(recording.batches).toEqual([2]);
    expect(queries).toHaveLength(3);
  });

  test("a scope's select() still loads the keys its nested includes need", async () => {
    const [user] = await db()
      .model(User)
      .includes({ postTitles: "author" })
      .where({ id: 2 })
      .toArray();

    const [post] = user!.loaded("postTitles");
    expect(post?.title).toBe("B1");
    expect(post?.loaded("author")?.email).toBe("b@example.com");
  });

  test("nested associations in different branches share a level", async () => {
    await binding.prepare("INSERT INTO comments (id, post_id, body) VALUES (1, 12, 'Hm')").run();

    const [user] = await db()
      .model(User)
      .includes({ posts: "comments", profile: "user" })
      .where({ id: 2 })
      .toArray();

    expect(recording.batches).toEqual([2, 2]);
    expect(queries).toHaveLength(5);
    const [post] = user!.loaded("posts");
    expect(post?.loaded("comments").map((comment) => comment.body)).toEqual(["Hm"]);
    expect(user?.loaded("profile")?.loaded("user")?.email).toBe("b@example.com");
  });

  test("an association scope's includes go with the next level's", async () => {
    await binding.prepare("INSERT INTO comments (id, post_id, body) VALUES (1, 12, 'Hm')").run();

    const [user] = await db()
      .model(User)
      .includes("profile", { postsWithComments: "author" })
      .where({ id: 2 })
      .toArray();

    expect(recording.batches).toEqual([2, 2]);
    expect(queries).toHaveLength(5);
    const [post] = user!.loaded("postsWithComments");
    expect(post?.loaded("comments").map((comment) => comment.body)).toEqual(["Hm"]);
    expect(post?.loaded("author")?.email).toBe("b@example.com");
  });

  test("an association scope of none() sends nothing for it", async () => {
    const [user] = await db().model(User).includes("noPosts", "profile").where({ id: 2 }).toArray();

    expect(user?.loaded("noPosts")).toEqual([]);
    expect(user?.loaded("profile")?.bio).toBe("Bee");
    expect(recording.batches).toEqual([]);
    expect(queries).toHaveLength(2);
  });

  // User 1 has posts and user 3 none: either way, the comments can't be preloaded.
  test.each([1, 3])(
    "a scope that can't be preloaded, a level down, throws before any preload is sent (user %i)",
    async (id) => {
      const loading = db().model(User).includes({ posts: "firstComment" }).where({ id }).toArray();

      await expect(loading).rejects.toThrow(IncompatibleRelation);
      expect(queries).toHaveLength(1);
    },
  );

  test("an association scope including itself preloads until a level finds nothing", async () => {
    await binding
      .prepare("INSERT INTO accounts (id, user_id) VALUES (1, NULL), (2, 1), (3, 2)")
      .run();

    const [root] = await db().model(Account).includes("children").where({ id: 1 }).toArray();

    const [child] = root!.loaded("children");
    expect(child?.loaded("children").map((account) => account.id)).toEqual([3]);
    expect(recording.batches).toEqual([]);
    expect(queries).toHaveLength(4);
  });

  test("with a Session, the batch goes through the Session", async () => {
    const sessionDb = connect(recording.binding, { session: "first-primary" });

    const users = await sessionDb
      .model(User)
      .includes("posts", "profile")
      .order({ id: "asc" })
      .toArray();

    expect(recording.sessionBatches).toEqual([2]);
    expect(recording.batches).toEqual([]);
    expect(users.map(titles)).toEqual([["A1", "A2"], ["B1"], []]);
  });

  test("a failed batch rejects with D1's error explained", async () => {
    const loading = db().model(User).includes("posts", "ghosts").toArray();

    await expect(loading).rejects.toThrow(InvalidModel);
    await expect(loading).rejects.toThrow(/Ghost's table "ghosts" doesn't exist/);
  });

  test("a failed batch reports each of its statements with D1's error", async () => {
    await db()
      .model(User)
      .includes("posts", "ghosts")
      .toArray()
      .catch(() => {});

    expect(recording.batches).toEqual([2]);
    expect(queries.map((query) => [query.model, query.error !== undefined])).toEqual([
      ["User", false],
      ["Post", true],
      ["Ghost", true],
    ]);
  });
});
