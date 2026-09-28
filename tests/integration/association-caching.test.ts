import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  AssociationNotLoaded,
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

describe("caching lazily loaded associations", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  const queries: QueryEvent[] = [];
  const db = () => connect(binding, { onQuery: (event) => queries.push(event) });

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
      binding.prepare(
        "INSERT INTO posts (id, user_id, title) VALUES (11, 1, 'A2'), (10, 1, 'A1'), (12, 2, 'B1')",
      ),
      binding.prepare("INSERT INTO profiles (id, user_id, bio) VALUES (1, 1, 'Ay')"),
    ]);
    queries.length = 0;
  });

  test("belongsTo and hasOne query once, then answer from the record", async () => {
    const post = await db().model(Post).find(10);
    const user = await db().model(User).find(1);
    queries.length = 0;

    const author = await post.author();
    expect(await post.author()).toBe(author);
    expect(await user.profile()).toBe(await user.profile());

    expect(queries).toHaveLength(2);
  });

  test("a null result is cached too", async () => {
    const user = await db().model(User).find(2);
    queries.length = 0;

    expect(await user.profile()).toBeNull();
    expect(await user.profile()).toBeNull();

    expect(queries).toHaveLength(1);
  });

  test("hasMany toArray() loads once, in target primary-key order, then answers from the record", async () => {
    const user = await db().model(User).find(1);
    queries.length = 0;

    const first = await user.posts().toArray();
    const second = await user.posts().toArray();

    expect(first.map((post) => post.id)).toEqual([10, 11]);
    expect(second).toEqual(first);
    expect(queries).toHaveLength(1);
  });

  test("on a loaded hasMany, first, last, take and pluck answer without a query; count still queries", async () => {
    const user = await db().model(User).find(1);
    await user.posts().toArray();
    queries.length = 0;

    expect((await user.posts().first())?.id).toBe(10);
    expect((await user.posts().last())?.id).toBe(11);
    expect((await user.posts().take())?.id).toBe(10);
    expect(await user.posts().pluck("title")).toEqual(["A1", "A2"]);
    expect(queries).toHaveLength(0);

    expect(await user.posts().count()).toBe(2);
    expect(queries).toHaveLength(1);
  });

  test("chaining on a loaded hasMany queries, and doesn't change what's cached", async () => {
    const user = await db().model(User).find(1);
    await user.posts().toArray();
    queries.length = 0;

    expect(await user.posts().where({ title: "A2" }).pluck("id")).toEqual([11]);
    expect(await user.posts().pluck("id")).toEqual([10, 11]);
    expect(queries).toHaveLength(1);
  });

  test("isLoaded() and loaded() see lazy loads as well as preloads", async () => {
    const post = await db().model(Post).find(10);

    expect(post.isLoaded("author")).toBe(false);
    expect(() => post.loaded("author")).toThrow(AssociationNotLoaded);

    await post.author();

    expect(post.isLoaded("author")).toBe(true);
    expect(post.loaded("author")?.id).toBe(1);
    expect((await db().model(Post).includes("author").find(10)).isLoaded("author")).toBe(true);
  });

  test("changing the foreign key makes the cached association stale, so the next read queries", async () => {
    const post = await db().model(Post).find(10);
    await post.author();
    queries.length = 0;

    post.userId = 2;

    expect(post.isLoaded("author")).toBe(false);
    expect((await post.author())?.id).toBe(2);
    expect(queries).toHaveLength(1);
  });

  test("…preloaded associations too", async () => {
    const post = await db().model(Post).includes("author").find(10);
    queries.length = 0;

    post.userId = 2;

    expect((await post.author())?.id).toBe(2);
    expect(queries).toHaveLength(1);
  });

  test("reload() clears the cache; save() keeps it", async () => {
    const post = await db().model(Post).find(10);
    await post.author();

    await post.updateOrThrow({ title: "Renamed" });
    expect(post.isLoaded("author")).toBe(true);

    await post.reload();
    expect(post.isLoaded("author")).toBe(false);
  });

  test("create through a loaded hasMany appends the new record", async () => {
    const user = await db().model(User).find(1);
    await user.posts().toArray();

    const created = await user.posts().createOrThrow({ title: "A3" });
    queries.length = 0;

    expect((await user.posts().toArray()).at(-1)).toBe(created);
    expect(queries).toHaveLength(0);
  });

  test("statements built through a hasMany clear its cache", async () => {
    const user = await db().model(User).find(1);
    await user.posts().toArray();

    await user.posts().updateAll({ title: "Changed" }).run();
    queries.length = 0;

    expect(await user.posts().pluck("title")).toEqual(["Changed", "Changed"]);
    expect(queries).toHaveLength(1);
  });

  test("reloadAssociation() queries again and returns the fresh value", async () => {
    const user = await db().model(User).find(1);
    const post = await db().model(Post).find(10);
    await user.posts().toArray();
    await post.author();
    await binding.prepare("UPDATE users SET email = 'new@example.com' WHERE id = 1").run();
    await binding.prepare("INSERT INTO posts (id, user_id, title) VALUES (13, 1, 'A3')").run();
    queries.length = 0;

    expect((await post.reloadAssociation("author"))?.email).toBe("new@example.com");
    expect((await user.reloadAssociation("posts")).map((each) => each.id)).toEqual([10, 11, 13]);
    expect(queries).toHaveLength(2);
    expect(user.loaded("posts")).toHaveLength(3);
  });

  test("a record with no key yet doesn't cache its hasMany", async () => {
    const user = db().model(User).build({ email: "new@example.com" });

    expect(await user.posts().toArray()).toEqual([]);
    expect(user.isLoaded("posts")).toBe(false);
  });
});
