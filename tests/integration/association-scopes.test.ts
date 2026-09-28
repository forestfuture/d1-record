import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  connect,
  IncompatibleRelation,
  Model,
  UnknownAttribute,
  type BelongsTo,
  type HasMany,
  type HasOne,
  type QueryEvent,
  type Relation,
} from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

class User extends Model({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
}) {
  static tableName = "users";

  static associations = this.defineAssociations({
    // Newest first, as Rails' `has_many :posts, -> { order(created_at: :desc) }`.
    posts: this.hasMany(() => Post, {
      foreignKey: "userId",
      scope: (q) => q.order({ createdAt: "desc" }),
    }),
    publishedPosts: this.hasMany(() => Post, {
      foreignKey: "userId",
      scope: (q: Relation<Post>) => q.where({ published: true }),
    }),
    drafts: this.hasMany(() => Post, { foreignKey: "userId", scope: (q) => q.drafts() }),
    latestPost: this.hasOne(() => Post, {
      foreignKey: "userId",
      scope: (q) => q.order({ createdAt: "desc" }),
    }),
    firstTwoPosts: this.hasMany(() => Post, {
      foreignKey: "userId",
      scope: (q) => q.order({ createdAt: "asc" }).limit(2),
    }),
  });

  declare posts: HasMany<typeof Post>;
  declare publishedPosts: HasMany<typeof Post>;
  declare drafts: HasMany<typeof Post>;
  declare latestPost: HasOne<typeof Post>;
  declare firstTwoPosts: HasMany<typeof Post>;
}

class Post extends Model({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
  published: { type: "boolean", null: false },
  createdAt: "datetime",
}) {
  static tableName = "posts";

  static scopes = this.defineScopes({
    drafts: (q) => q.where({ published: false }),
  });

  static associations = this.defineAssociations({
    admin: this.belongsTo(() => User, {
      foreignKey: "userId",
      scope: (q) => q.where({ role: "admin" }),
    }),
  });

  declare admin: BelongsTo<typeof User>;
}

class Broken extends Model({
  id: { type: "integer", null: false },
}) {
  static tableName = "users";

  static associations = this.defineAssociations({
    typo: this.hasMany(() => Post, { foreignKey: "userId", scope: (q) => q.where({ nope: 1 }) }),
    notARelation: this.hasMany(() => Post, { foreignKey: "userId", scope: () => "posts" }),
  });

  declare typo: HasMany<typeof Post>;
  declare notARelation: HasMany<typeof Post>;
}

const ids = (records: readonly { id: number }[]) => records.map((record) => record.id);

describe("association scopes", () => {
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
      binding.prepare("DELETE FROM users"),
      binding.prepare(
        "INSERT INTO users (id, email, role) VALUES (1, 'a@example.com', 'admin'), (2, 'b@example.com', 'member')",
      ),
      binding.prepare(
        `INSERT INTO posts (id, user_id, title, published, created_at) VALUES
           (10, 1, 'Old',    1, '2026-01-01T00:00:00.000Z'),
           (11, 1, 'New',    0, '2026-03-01T00:00:00.000Z'),
           (12, 1, 'Middle', 1, '2026-02-01T00:00:00.000Z'),
           (13, 2, 'Other',  1, '2026-01-15T00:00:00.000Z')`,
      ),
    ]);
    queries.length = 0;
  });

  test("a hasMany scope orders the lazy load and the preload alike", async () => {
    const user = await db().model(User).find(1);
    const [preloaded] = await db().model(User).where({ id: 1 }).includes("posts").toArray();

    expect(ids(await user.posts().toArray())).toEqual([11, 12, 10]);
    expect(ids(preloaded!.loaded("posts"))).toEqual([11, 12, 10]);
  });

  test("a hasMany scope's conditions filter lazy loads and preloads", async () => {
    const user = await db().model(User).find(1);
    const users = await db().model(User).includes("publishedPosts").order({ id: "asc" }).toArray();

    expect(ids(await user.publishedPosts().toArray())).toEqual([10, 12]);
    expect(users.map((each) => ids(each.loaded("publishedPosts")))).toEqual([[10, 12], [13]]);
  });

  test("a scope can use the target's own named scopes", async () => {
    const user = await db().model(User).find(1);

    expect(ids(await user.drafts().toArray())).toEqual([11]);
  });

  test("records created through a scoped hasMany take its equality values", async () => {
    const user = await db().model(User).find(1);

    const created = await user.publishedPosts().createOrThrow({ title: "Fresh" });

    expect(created.published).toBe(true);
    expect(created.userId).toBe(1);
  });

  test("a hasOne scope's order picks the record, lazily and when preloaded", async () => {
    const user = await db().model(User).find(1);
    const preloaded = await db().model(User).includes("latestPost").find(1);

    expect((await user.latestPost())?.id).toBe(11);
    expect(preloaded.loaded("latestPost")?.id).toBe(11);
  });

  test("on a tie in the scope's order, lazy and preloaded hasOne pick the same record: the lowest key", async () => {
    await binding
      .prepare("UPDATE posts SET created_at = '2026-03-01T00:00:00.000Z' WHERE id = 10")
      .run();
    const user = await db().model(User).find(1);
    const preloaded = await db().model(User).includes("latestPost").find(1);

    expect((await user.latestPost())?.id).toBe(10);
    expect(preloaded.loaded("latestPost")?.id).toBe(10);
  });

  test("a belongsTo scope's conditions apply: no match reads as null", async () => {
    const posts = await db().model(Post).includes("admin").order({ id: "asc" }).toArray();
    const other = await db().model(Post).find(13);

    expect(posts.map((post) => post.loaded("admin")?.id ?? null)).toEqual([1, 1, 1, null]);
    expect(await other.admin()).toBeNull();
  });

  test("a scope with a limit works lazily, but can't be preloaded", async () => {
    const user = await db().model(User).find(1);

    expect(ids(await user.firstTwoPosts().toArray())).toEqual([10, 12]);
    await expect(db().model(User).includes("firstTwoPosts").toArray()).rejects.toThrow(
      IncompatibleRelation,
    );
  });

  test("a scope naming an unknown attribute, or not returning a Relation, throws on first use", async () => {
    const broken = await db().model(Broken).find(1);

    expect(() => broken.typo()).toThrow(UnknownAttribute);
    expect(() => broken.notARelation()).toThrow(TypeError);
  });
});
