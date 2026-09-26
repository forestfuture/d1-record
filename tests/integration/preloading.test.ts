import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  connect,
  Model,
  type BelongsTo,
  type HasMany,
  type HasOne,
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

class Post extends Model({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static tableName = "posts";

  static associations = this.defineAssociations({
    author: this.belongsTo(() => User, { foreignKey: "userId" }),
  });

  declare author: BelongsTo<typeof User>;
}

class Profile extends Model({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  bio: "string",
}) {
  static tableName = "profiles";
}

describe("preloading with includes", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  const queries: QueryEvent[] = [];
  const db = () => connect(binding, { onQuery: (event) => queries.push(event) });

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    queries.length = 0;
    await binding.batch([
      binding.prepare("DELETE FROM comments"),
      binding.prepare("DELETE FROM posts"),
      binding.prepare("DELETE FROM profiles"),
      binding.prepare("DELETE FROM users"),
      binding.prepare(
        "INSERT INTO users (id, email) VALUES (1, 'a@example.com'), (2, 'b@example.com'), (3, 'c@example.com')",
      ),
      binding.prepare(
        "INSERT INTO posts (id, user_id, title) VALUES (10, 1, 'A1'), (11, 1, 'A2'), (12, 2, 'B1')",
      ),
      binding.prepare("INSERT INTO profiles (id, user_id, bio) VALUES (1, 2, 'Bee')"),
    ]);
  });

  test("hasMany preloads in one query, and reading it afterwards sends none", async () => {
    const users = await db().model(User).includes("posts").order({ id: "asc" }).toArray();
    expect(queries).toHaveLength(2);
    queries.length = 0;

    const titles = await Promise.all(
      users.map(async (user) => (await user.posts().toArray()).map((post) => post.title)),
    );

    expect(titles).toEqual([["A1", "A2"], ["B1"], []]);
    expect(queries).toHaveLength(0);
  });

  test("belongsTo and hasOne preload too, with null where there's nothing", async () => {
    const posts = await db().model(Post).includes("author").order({ id: "asc" }).toArray();
    const users = await db().model(User).includes("profile").order({ id: "asc" }).toArray();
    expect(queries).toHaveLength(4);
    queries.length = 0;

    const authors = await Promise.all(posts.map(async (post) => (await post.author())?.email));
    const bios = await Promise.all(users.map(async (user) => (await user.profile())?.bio ?? null));

    expect(authors).toEqual(["a@example.com", "a@example.com", "b@example.com"]);
    expect(bios).toEqual([null, "Bee", null]);
    expect(queries).toHaveLength(0);
  });

  test("chaining on a preloaded hasMany queries as normal", async () => {
    const [user] = await db().model(User).includes("posts").where({ id: 1 }).toArray();
    queries.length = 0;

    expect(await user?.posts().where({ title: "A2" }).count()).toBe(1);
    expect(queries).toHaveLength(1);
  });
});
