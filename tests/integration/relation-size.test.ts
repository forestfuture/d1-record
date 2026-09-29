import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { connect, Model, type HasMany, type QueryEvent } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

class User extends Model({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static tableName = "users";

  static associations = this.defineAssociations({
    posts: this.hasMany(() => Post, { foreignKey: "userId" }),
  });

  declare posts: HasMany<typeof Post>;
}

class Post extends Model({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static tableName = "posts";
}

describe("size, isEmpty and hasAny", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  const events: QueryEvent[] = [];
  const db = () => connect(binding, { onQuery: (event) => events.push(event) });

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.batch([
      binding.prepare("DELETE FROM posts"),
      binding.prepare("DELETE FROM users"),
      binding.prepare(
        "INSERT INTO users (id, email) VALUES (1, 'a@example.com'), (2, 'b@example.com')",
      ),
      binding.prepare("INSERT INTO posts (id, user_id, title) VALUES (10, 1, 'A'), (11, 1, 'B')"),
    ]);
    events.length = 0;
  });

  test("on a Relation, size() counts and isEmpty()/hasAny() check existence, one query each", async () => {
    const posts = db().model(Post);

    expect(await posts.size()).toBe(2);
    expect(await posts.where({ userId: 2 }).isEmpty()).toBe(true);
    expect(await posts.hasAny()).toBe(true);
    expect(events).toHaveLength(3);
  });

  test("none() answers without a query", async () => {
    const posts = db().model(Post).none();

    expect([await posts.size(), await posts.isEmpty(), await posts.hasAny()]).toEqual([
      0,
      true,
      false,
    ]);
    expect(events).toHaveLength(0);
  });

  test("a loaded association answers from its records, built ones included, without a query", async () => {
    const user = await db().model(User).find(1);
    await user.posts().toArray();
    user.posts().build({ title: "C" });
    events.length = 0;

    expect(await user.posts().size()).toBe(3);
    expect(await user.posts().isEmpty()).toBe(false);
    expect(await user.posts().hasAny()).toBe(true);
    expect(events).toHaveLength(0);
  });

  test("an association that isn't loaded counts, adding its unsaved built records, as Rails' size does", async () => {
    const user = await db().model(User).find(1);
    user.posts().build({ title: "C" });
    events.length = 0;

    expect(await user.posts().size()).toBe(3);
    expect(await user.posts().isEmpty()).toBe(false);
    expect(events).toHaveLength(1);
  });

  test("an unsaved owner's association is just its built records", async () => {
    const user = db().model(User).build({ email: "new@example.com" });

    expect(await user.posts().isEmpty()).toBe(true);
    user.posts().build({ title: "A" });
    expect(await user.posts().size()).toBe(1);
    expect(await user.posts().hasAny()).toBe(true);
    expect(events).toHaveLength(0);
  });
});
