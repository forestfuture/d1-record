import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { connect, Model, type BelongsTo, type HasMany, type HasOne } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

// Foreign keys inferred by Rails' convention: no foreignKey anywhere below.
class User extends Model({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static tableName = "users";

  static associations = this.defineAssociations({
    posts: this.hasMany(() => Post), // User → userId
    profile: this.hasOne(() => Profile), // User → userId
  });

  declare posts: HasMany<typeof Post>;
  declare profile: HasOne<typeof Profile>;
}

class Post extends Model({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static tableName = "posts";

  static associations = this.defineAssociations({
    user: this.belongsTo(() => User), // user → userId
  });

  declare user: BelongsTo<typeof User>;
}

// Named so their inferred keys (writerId, authorId) don't exist: the explicit ones must be used.
class Writer extends Model({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static tableName = "users";

  static associations = this.defineAssociations({
    posts: this.hasMany(() => Article, { foreignKey: "userId" }),
  });

  declare posts: HasMany<typeof Article>;
}

class Article extends Model({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static tableName = "posts";

  static associations = this.defineAssociations({
    author: this.belongsTo(() => Writer, { foreignKey: "userId" }),
  });

  declare author: BelongsTo<typeof Writer>;
}

class Profile extends Model({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  bio: "string",
}) {
  static tableName = "profiles";
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

  test("an inferred key is used for building, preloading and autosave alike", async () => {
    const db = connect(binding);
    const [user] = await db.model(User).where({ id: 2 }).includes("posts").toArray();
    const built = user!.posts().build({ title: "C" });
    await user!.saveOrThrow();

    expect((await user!.posts().toArray()).map((post) => post.title)).toEqual(["B", "C"]);
    expect(built.userId).toBe(2);
  });
});
