import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  connect,
  Model,
  RecordNotSaved,
  type BelongsTo,
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
    profile: this.hasOne(() => Profile, { foreignKey: "userId" }),
  });

  declare profile: HasOne<typeof Profile>;

  static {
    this.validates("email", { presence: true });
  }
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

let counter = 0;

class ApiKey extends Model({
  id: { type: "string", null: false, default: () => `key-${++counter}` },
  label: { type: "string", null: false },
}) {
  static tableName = "api_keys";
}

class Account extends Model({
  id: { type: "integer", null: false },
  externalAccountId: "string",
}) {
  static tableName = "accounts";

  static associations = this.defineAssociations({
    apiKey: this.belongsTo(() => ApiKey, { foreignKey: "externalAccountId" }),
  });

  declare apiKey: BelongsTo<typeof ApiKey>;
}

describe("building and setting hasOne and belongsTo", () => {
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
      binding.prepare("DELETE FROM profiles"),
      binding.prepare("DELETE FROM users"),
      binding.prepare("DELETE FROM accounts"),
      binding.prepare("DELETE FROM api_keys"),
      binding.prepare(
        "INSERT INTO users (id, email) VALUES (1, 'a@example.com'), (2, 'b@example.com')",
      ),
      binding.prepare("INSERT INTO posts (id, user_id, title) VALUES (10, 1, 'Hello')"),
    ]);
    events.length = 0;
  });

  describe("belongsTo", () => {
    test("set() points the record at another, which then reads without a query, and save writes it", async () => {
      const database = db();
      const post = await database.model(Post).find(10);
      const other = await database.model(User).find(2);
      events.length = 0;

      post.author.set(other);

      expect(post.userId).toBe(2);
      expect(await post.author()).toBe(other);
      expect(events).toHaveLength(0);
      await post.saveOrThrow();
      expect((await database.model(Post).find(10)).userId).toBe(2);
    });

    test("set(null) clears the key and the association", async () => {
      const post = db().model(Post).build({ title: "Draft", userId: 1 });

      post.author.set(null);

      expect(post.userId).toBeNull();
      expect(await post.author()).toBeNull();
      expect(post.isLoaded("author")).toBe(true);
    });

    test("set() takes only a record of the association's Model", () => {
      const post = db().model(Post).build({ title: "Draft" });

      expect(() => post.author.set(post as never)).toThrow(TypeError);
    });

    test("a built author is validated with the post, saved first, and the post points at it", async () => {
      const post = db().model(Post).build({ title: "Hello again" });
      const author = post.author.build({ email: "new@example.com" });

      await post.saveOrThrow();

      expect(author.isPersisted()).toBe(true);
      expect(post.userId).toBe(author.id);
      expect(await post.author()).toBe(author);
    });

    test("an invalid built author makes the post invalid, and nothing is written", async () => {
      const post = db().model(Post).build({ title: "Hello again" });
      post.author.build({ email: "" });

      expect(await post.save()).toBe(false);

      expect(post.errors.fullMessages()).toEqual(["Author is invalid"]);
      expect(await db().model(User).count()).toBe(2);
    });

    test("with a key generated in code, the new record and the owner are one atomic batch", async () => {
      const account = db().model(Account).build({ id: 1 });
      const key = account.apiKey.build({ label: "deploy" });
      events.length = 0;

      await account.saveOrThrow();

      expect(events).toHaveLength(2);
      expect(account.externalAccountId).toBe(key.id);
    });

    test("create() saves the new record at once and points the owner at it, without saving the owner", async () => {
      const post = await db().model(Post).find(10);

      const author = await post.author.createOrThrow({ email: "c@example.com" });

      expect(author.isPersisted()).toBe(true);
      expect(post.userId).toBe(author.id);
      expect(post.changed()).toEqual(["userId"]);
    });
  });

  describe("hasOne", () => {
    test("build() makes a record pointing at a saved owner, which reads it without a query and saves it", async () => {
      const database = db();
      const user = await database.model(User).find(2);
      events.length = 0;

      const profile = user.profile.build({ bio: "Hi" });

      expect(profile.userId).toBe(2);
      expect(await user.profile()).toBe(profile);
      expect(events).toHaveLength(0);
      await user.saveOrThrow();
      expect(profile.isPersisted()).toBe(true);
    });

    test("an unsaved owner's built record is saved with it, with its new key", async () => {
      const user = db().model(User).build({ email: "new@example.com" });
      const profile = user.profile.build({ bio: "Hi" });

      await user.saveOrThrow();

      expect(profile.userId).toBe(user.id);
      expect((await db().model(Profile).findByOrThrow({ userId: user.id })).bio).toBe("Hi");
    });

    test("create() saves at once, and throws RecordNotSaved for an unsaved owner", async () => {
      const user = await db().model(User).find(1);
      const created = await user.profile.createOrThrow({ bio: "Hi" });
      const unsaved = db().model(User).build({ email: "new@example.com" });

      expect(created.isPersisted()).toBe(true);
      expect(await user.profile()).toBe(created);
      await expect(unsaved.profile.create({ bio: "Hi" })).rejects.toThrow(RecordNotSaved);
    });

    test("building a replacement leaves the existing record untouched", async () => {
      await binding.prepare("INSERT INTO profiles (id, user_id, bio) VALUES (1, 1, 'Old')").run();
      const user = await db().model(User).find(1);

      user.profile.build({ bio: "New" });
      await user.saveOrThrow();

      expect(await db().model(Profile).order({ id: "asc" }).pluck("bio")).toEqual(["Old", "New"]);
    });
  });

  test("in a batch, a new belongsTo record is saved when its key is known, and refused when D1 generates it", async () => {
    const database = db();
    const account = database.model(Account).build({ id: 1 });
    account.apiKey.build({ label: "deploy" });
    const post = database.model(Post).build({ title: "Hello again" });
    post.author.build({ email: "new@example.com" });

    await database.batch([account.saveStatement()]);
    expect(await database.model(ApiKey).count()).toBe(1);

    await expect(database.batch([post.saveStatement()])).rejects.toThrow(RecordNotSaved);
  });
});
