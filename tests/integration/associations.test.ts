import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  connect,
  Model,
  type BelongsTo,
  type HasMany,
  type HasOne,
  RecordNotSaved,
  type QueryEvent,
} from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

class User extends Model({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static tableName = "users";

  static associations = this.defineAssociations({
    posts: this.hasMany(() => Post, { foreignKey: "userId" }),
    profile: this.hasOne(() => Profile, { foreignKey: "userId" }),
  });

  declare posts: HasMany<typeof Post>;
  declare profile: HasOne<typeof Profile>;
}

class Profile extends Model({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  bio: "string",
}) {
  static tableName = "profiles";
}

class Comment extends Model({
  id: { type: "integer", null: false },
  postId: "integer",
  body: "string",
}) {
  static tableName = "comments";

  static associations = this.defineAssociations({
    post: this.belongsTo(() => Post, { foreignKey: "postId" }),
  });

  declare post: BelongsTo<typeof Post>;
}

class Post extends Model({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
  published: "boolean",
}) {
  static tableName = "posts";

  static associations = this.defineAssociations({
    author: this.belongsTo(() => User, { foreignKey: "userId" }),
  });

  static scopes = this.defineScopes({
    published: (q) => q.where({ published: true }),
  });

  declare author: BelongsTo<typeof User>;
}

describe("associations", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.batch([
      binding.prepare("DELETE FROM comments"),
      binding.prepare("DELETE FROM posts"),
      binding.prepare("DELETE FROM profiles"),
      binding.prepare("DELETE FROM users"),
      binding.prepare(
        "INSERT INTO users (id, email) VALUES (1, 'a@example.com'), (2, 'b@example.com')",
      ),
      binding.prepare(
        `INSERT INTO posts (id, user_id, title, published) VALUES
           (10, 1, 'First', 1), (11, 1, 'Draft', 0), (12, 2, 'Other', 1)`,
      ),
    ]);
  });

  test("belongsTo loads the owning record through the same Database, in one query", async () => {
    const queries: QueryEvent[] = [];
    const db = connect(binding, { onQuery: (event) => queries.push(event) });
    const post = await db.model(Post).find(12);
    queries.length = 0;

    const author = await post.author();

    expect(author).toBeInstanceOf(User);
    expect(author?.email).toBe("b@example.com");
    expect(queries).toHaveLength(1);
  });

  test("hasOne loads the one record pointing at this one, or null", async () => {
    await binding.prepare("INSERT INTO profiles (id, user_id, bio) VALUES (1, 1, 'Hello')").run();
    const users = connect(binding).model(User);

    const withProfile = await (await users.find(1)).profile();
    const withoutProfile = await (await users.find(2)).profile();

    expect(withProfile).toBeInstanceOf(Profile);
    expect(withProfile?.bio).toBe("Hello");
    expect(withoutProfile).toBeNull();
  });

  test("a missing foreign key, or an unsaved owner, resolves to null without querying", async () => {
    const queries: QueryEvent[] = [];
    const db = connect(binding, { onQuery: (event) => queries.push(event) });
    const orphan = db.model(Comment).build({ body: "no post" });
    const newUser = db.model(User).build({ email: "new@example.com" });

    expect(await orphan.post()).toBeNull();
    expect(await newUser.profile()).toBeNull();
    expect(queries).toHaveLength(0);
  });

  test("hasMany returns a lazy Relation of the target, with its scopes", async () => {
    const queries: QueryEvent[] = [];
    const users = connect(binding, { onQuery: (event) => queries.push(event) }).model(User);
    const user = await users.find(1);
    queries.length = 0;

    const published = user.posts().published().order({ id: "asc" });
    expect(queries).toHaveLength(0);

    expect((await published.toArray()).map((post) => post.title)).toEqual(["First"]);
    expect(await user.posts().count()).toBe(2);
  });

  test("records built or created through hasMany get the owner's key", async () => {
    const user = await connect(binding).model(User).find(2);

    const built = user.posts().build({ title: "Built" });
    const created = await user.posts().create({ title: "Created" });

    expect(built.userId).toBe(2);
    expect(created.isPersisted()).toBe(true);
    expect(await user.posts().count()).toBe(2);
  });

  test("creating through an unsaved owner throws RecordNotSaved, as in Rails; building is allowed", async () => {
    const owner = connect(binding).model(User).build({ email: "new@example.com" });

    expect(owner.posts().build({ title: "Later" }).userId).toBeNull();
    expect(await owner.posts().count()).toBe(0);
    await expect(owner.posts().create({ title: "Now" })).rejects.toThrow(RecordNotSaved);
    await expect(owner.posts().createOrThrow({ title: "Now" })).rejects.toThrow(
      /save the User first/,
    );
  });
});
