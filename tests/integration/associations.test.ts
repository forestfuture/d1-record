import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { connect, Model, type BelongsTo, type HasMany, type QueryEvent } from "../../src/index.ts";
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
  published: "boolean",
}) {
  static tableName = "posts";

  static associations = this.defineAssociations({
    author: this.belongsTo(() => User, { foreignKey: "userId" }),
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
});
