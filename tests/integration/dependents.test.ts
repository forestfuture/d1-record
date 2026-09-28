import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  abort,
  connect,
  DeleteRestriction,
  InvalidForeignKey,
  InvalidModel,
  Model,
  RecordNotDestroyed,
  type HasMany,
  type HasOne,
} from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

const log: string[] = [];

class Post extends Model({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static tableName = "posts";

  static associations = this.defineAssociations({
    comments: this.hasMany(() => Comment, { foreignKey: "postId", dependent: "nullify" }),
  });

  declare comments: HasMany<typeof Comment>;

  static {
    this.beforeDestroy((post) => {
      if (post.title === "Keep") throw abort("this post is kept");
    });
    this.afterDestroy((post) => void log.push(`destroyed post ${post.id}`));
  }
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
}) {
  static tableName = "profiles";
}

const userAttributes = {
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
} as const;

class User extends Model(userAttributes) {
  static tableName = "users";
}

class Destroying extends Model(userAttributes) {
  static tableName = "users";
  static associations = this.defineAssociations({
    posts: this.hasMany(() => Post, { foreignKey: "userId", dependent: "destroy" }),
  });
  declare posts: HasMany<typeof Post>;
}

class DeletingAll extends Model(userAttributes) {
  static tableName = "users";
  static associations = this.defineAssociations({
    posts: this.hasMany(() => Post, { foreignKey: "userId", dependent: "deleteAll" }),
  });
  declare posts: HasMany<typeof Post>;
}

class DeletingProfile extends Model(userAttributes) {
  static tableName = "users";
  static associations = this.defineAssociations({
    profile: this.hasOne(() => Profile, { foreignKey: "userId", dependent: "delete" }),
  });
  declare profile: HasOne<typeof Profile>;
}

class Restricting extends Model(userAttributes) {
  static tableName = "users";
  static associations = this.defineAssociations({
    posts: this.hasMany(() => Post, { foreignKey: "userId", dependent: "restrictWithException" }),
  });
  declare posts: HasMany<typeof Post>;
}

class RestrictingWithError extends Model(userAttributes) {
  static tableName = "users";
  static associations = this.defineAssociations({
    posts: this.hasMany(() => Post, { foreignKey: "userId", dependent: "restrictWithError" }),
    profile: this.hasOne(() => Profile, { foreignKey: "userId", dependent: "restrictWithError" }),
  });
  declare posts: HasMany<typeof Post>;
  declare profile: HasOne<typeof Profile>;
}

class Aborting extends Model(userAttributes) {
  static tableName = "users";
  static associations = this.defineAssociations({
    posts: this.hasMany(() => Post, { foreignKey: "userId", dependent: "deleteAll" }),
  });
  declare posts: HasMany<typeof Post>;

  static {
    this.beforeDestroy(() => {
      throw abort("not today");
    });
  }
}

class Misdeclared extends Model(userAttributes) {
  static tableName = "users";
  static associations = this.defineAssociations({
    profile: this.hasOne(() => Profile, { foreignKey: "userId", dependent: "deleteAll" as never }),
  });
}

describe("dependent: strategies", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  const db = () => connect(binding);
  const count = async (table: string) =>
    (await binding.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    log.length = 0;
    await binding.batch([
      binding.prepare("DELETE FROM comments"),
      binding.prepare("DELETE FROM posts"),
      binding.prepare("DELETE FROM profiles"),
      binding.prepare("DELETE FROM users"),
      binding.prepare(
        "INSERT INTO users (id, email) VALUES (1, 'a@example.com'), (2, 'b@example.com')",
      ),
      binding.prepare(
        "INSERT INTO posts (id, user_id, title) VALUES (10, 1, 'A'), (11, 1, 'B'), (12, 2, 'C')",
      ),
      binding.prepare("INSERT INTO comments (id, post_id, body) VALUES (1, 10, 'x'), (2, 12, 'y')"),
    ]);
  });

  test("without a strategy, the foreign key constraint refuses to orphan the posts", async () => {
    const user = await db().model(User).find(1);

    await expect(user.destroy()).rejects.toThrow(InvalidForeignKey);
    expect(await count("users")).toBe(2);
  });

  test("destroy runs each child's destroy lifecycle, then deletes the owner", async () => {
    const user = await db().model(Destroying).find(1);

    expect(await user.destroy()).toBe(user);

    expect(log).toEqual(["destroyed post 10", "destroyed post 11"]);
    expect(await db().model(Post).pluck("id")).toEqual([12]);
    // Each post's own dependent ran too: its comments were nullified.
    expect(await db().model(Comment).order({ id: "asc" }).pluck("postId")).toEqual([null, 12]);
  });

  test("destroy isn't atomic: a child that aborts stops the owner's destroy, but earlier children stay destroyed", async () => {
    await binding.prepare("UPDATE posts SET title = 'Keep' WHERE id = 11").run();
    const user = await db().model(Destroying).find(1);

    await expect(user.destroy()).rejects.toThrow(RecordNotDestroyed);

    expect(await db().model(Post).order({ id: "asc" }).pluck("id")).toEqual([11, 12]);
    expect(await count("users")).toBe(2);
  });

  test("deleteAll deletes the children in the same batch as the owner, without their callbacks", async () => {
    await binding.prepare("DELETE FROM comments").run();
    const user = await db().model(DeletingAll).find(1);

    await user.destroyOrThrow();

    expect(log).toEqual([]);
    expect(await db().model(Post).pluck("id")).toEqual([12]);
    expect(await count("users")).toBe(1);
  });

  test("…so if the owner's DELETE fails, the children's deletion is rolled back too", async () => {
    await binding.batch([
      binding.prepare("DELETE FROM comments"),
      binding.prepare("INSERT INTO profiles (id, user_id) VALUES (1, 1)"),
    ]);
    const user = await db().model(DeletingAll).find(1);

    await expect(user.destroy()).rejects.toThrow(InvalidForeignKey);

    expect(await db().model(Post).order({ id: "asc" }).pluck("id")).toEqual([10, 11, 12]);
  });

  test("nullify sets the children's foreign key to NULL", async () => {
    const post = await db().model(Post).find(10);

    await post.destroyOrThrow();

    expect(await db().model(Comment).order({ id: "asc" }).pluck("postId")).toEqual([null, 12]);
  });

  test("a hasOne's delete deletes its record", async () => {
    await binding.batch([
      binding.prepare("DELETE FROM comments"),
      binding.prepare("DELETE FROM posts"),
      binding.prepare("INSERT INTO profiles (id, user_id) VALUES (1, 1), (2, 2)"),
    ]);
    const user = await db().model(DeletingProfile).find(1);

    await user.destroyOrThrow();

    expect(await db().model(Profile).pluck("id")).toEqual([2]);
  });

  test("restrictWithException throws DeleteRestriction while there are children", async () => {
    const user = await db().model(Restricting).find(1);

    const error: unknown = await user.destroy().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DeleteRestriction);
    expect((error as Error).message).toBe("Cannot delete record because of dependent posts");
    expect(await count("users")).toBe(2);
  });

  test("restrictWithError adds an error instead, so destroy() returns false", async () => {
    await binding.batch([
      binding.prepare("DELETE FROM comments WHERE id = 2"),
      binding.prepare("DELETE FROM posts WHERE id = 12"),
      binding.prepare("INSERT INTO profiles (id, user_id) VALUES (1, 2)"),
    ]);
    const withPosts = await db().model(RestrictingWithError).find(1);
    const withProfile = await db().model(RestrictingWithError).find(2);

    expect(await withPosts.destroy()).toBe(false);
    expect(withPosts.errors.get("base")).toEqual([
      "Cannot delete record because dependent posts exist",
    ]);
    await expect(withProfile.destroyOrThrow()).rejects.toThrow(RecordNotDestroyed);
    expect(withProfile.errors.get("base")).toEqual([
      "Cannot delete record because a dependent profile exists",
    ]);
    expect(await count("users")).toBe(2);
  });

  test("restricting lets an owner without children be destroyed", async () => {
    await binding.batch([
      binding.prepare("DELETE FROM comments"),
      binding.prepare("DELETE FROM posts"),
    ]);
    const user = await db().model(Restricting).find(1);

    expect(await user.destroy()).toBe(user);
  });

  test("strategies run after the owner's beforeDestroy callbacks, so an abort leaves the children alone", async () => {
    const user = await db().model(Aborting).find(1);

    expect(await user.destroy()).toBe(false);

    expect(await db().model(Post).count()).toBe(3);
  });

  test("deleteAll() on the association deletes with destroy or deleteAll, and nullifies otherwise", async () => {
    await binding.prepare("DELETE FROM comments").run();
    const destroying = await db().model(Destroying).find(1);
    const post = await db().model(Post).find(12);
    await binding.prepare("INSERT INTO comments (id, post_id, body) VALUES (3, 12, 'z')").run();

    await destroying.posts().deleteAll().run();
    await post.comments().deleteAll().run();

    expect(await db().model(Post).pluck("id")).toEqual([12]);
    expect(await db().model(Comment).pluck("postId")).toEqual([null]);
  });

  test("a strategy the association kind doesn't have is an InvalidModel", () => {
    expect(() => db().model(Misdeclared)).toThrow(InvalidModel);
  });
});
