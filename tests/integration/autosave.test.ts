import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  connect,
  Model,
  RecordInvalid,
  RecordNotSaved,
  RecordNotUnique,
  type HasMany,
  type QueryEvent,
} from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

const log: string[] = [];

class User extends Model({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static tableName = "users";

  static associations = this.defineAssociations({
    posts: this.hasMany(() => Post, { foreignKey: "userId" }),
  });

  declare posts: HasMany<typeof Post>;

  static {
    this.beforeSave((user) => void log.push(`before save ${user.email}`));
    this.afterSave((user) => void log.push(`after save ${user.email}`));
  }
}

class Post extends Model({
  id: { type: "integer", null: false },
  userId: "integer",
  title: { type: "string", null: false },
}) {
  static tableName = "posts";

  static {
    this.validates("title", { presence: true });
    this.beforeSave((post) => void log.push(`before save ${post.title}`));
    this.afterSave((post) => void log.push(`after save ${post.title}`));
  }
}

let counter = 0;

class ApiKey extends Model({
  id: { type: "string", null: false, default: () => `key-${++counter}` },
  label: { type: "string", null: false },
}) {
  static tableName = "api_keys";

  static associations = this.defineAssociations({
    accounts: this.hasMany(() => Account, { foreignKey: "externalAccountId" }),
  });

  declare accounts: HasMany<typeof Account>;
}

class Account extends Model({
  id: { type: "integer", null: false },
  externalAccountId: "string",
}) {
  static tableName = "accounts";
}

describe("autosave: records built through a hasMany are saved with their owner", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  const events: QueryEvent[] = [];
  const db = () => connect(binding, { onQuery: (event) => events.push(event) });

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    log.length = 0;
    await binding.batch([
      binding.prepare("DELETE FROM posts"),
      binding.prepare("DELETE FROM users"),
      binding.prepare("DELETE FROM accounts"),
      binding.prepare("DELETE FROM api_keys"),
    ]);
    events.length = 0;
  });

  test("saving a new owner inserts its built records with the owner's new key", async () => {
    const user = db().model(User).build({ email: "a@example.com" });
    const post = user.posts().build({ title: "Hello" });
    expect(post.userId).toBeNull();

    expect(await user.save()).toBe(true);

    expect(post.isPersisted()).toBe(true);
    expect(post.userId).toBe(user.id);
    expect(await db().model(Post).pluck("userId")).toEqual([user.id]);
  });

  test("an unsaved owner's association reads its built records, without a query", async () => {
    const user = db().model(User).build({ email: "a@example.com" });
    const first = user.posts().build({ title: "One" });
    user.posts().where({ title: "Two" }).build();

    expect(await user.posts().toArray()).toHaveLength(2);
    expect(await user.posts().first()).toBe(first);
    expect(await user.posts().pluck("title")).toEqual(["One", "Two"]);
    expect(events).toHaveLength(0);
  });

  test("a saved owner's loaded collection includes a built record, and saving the owner saves it", async () => {
    const user = await db().model(User).createOrThrow({ email: "a@example.com" });
    await user.posts().toArray();
    const post = user.posts().build({ title: "Later" });
    events.length = 0;

    expect(await user.posts().toArray()).toEqual([post]);
    await user.saveOrThrow();

    expect(post.isPersisted()).toBe(true);
    expect(post.userId).toBe(user.id);
  });

  test("an invalid built record makes the owner invalid, and nothing is written", async () => {
    const user = db().model(User).build({ email: "a@example.com" });
    const post = user.posts().build({ title: "" });

    expect(await user.save()).toBe(false);

    expect(user.errors.fullMessages()).toEqual(["Posts is invalid"]);
    expect(post.errors.get("title")).toEqual(["can't be blank"]);
    expect(user.isNewRecord()).toBe(true);
    await expect(user.saveOrThrow()).rejects.toThrow(RecordInvalid);
    expect(await db().model(User).count()).toBe(0);
  });

  test("callbacks: the owner's before, the records' before, the writes, the owner's after, the records' after", async () => {
    const user = db().model(User).build({ email: "a@example.com" });
    user.posts().build({ title: "Hello" });

    await user.saveOrThrow();

    expect(log).toEqual([
      "before save a@example.com",
      "before save Hello",
      "after save a@example.com",
      "after save Hello",
    ]);
  });

  test("with a key generated in code, the owner and its records are written in one batch, atomically", async () => {
    await binding.prepare("INSERT INTO accounts (id) VALUES (1)").run();
    const key = db().model(ApiKey).build({ label: "deploy" });
    key.accounts().build({ id: 2 });
    key.accounts().build({ id: 1 });
    events.length = 0;

    await expect(key.save()).rejects.toThrow(RecordNotUnique);

    expect(events).toHaveLength(3);
    expect(key.isNewRecord()).toBe(true);
    expect(await db().model(ApiKey).count()).toBe(0);
    expect(await db().model(Account).pluck("id")).toEqual([1]);
  });

  test("…and the records get the owner's key before anything is written", async () => {
    const key = db().model(ApiKey).build({ label: "deploy" });
    const account = key.accounts().build({ id: 1 });

    await key.saveOrThrow();

    expect(account.externalAccountId).toBe(key.id);
    expect(await key.accounts().pluck("id")).toEqual([1]);
  });

  test("with a key D1 generates, the owner is written first: a record that then fails leaves the owner saved", async () => {
    await binding.prepare("INSERT INTO users (id, email) VALUES (1, 'x@example.com')").run();
    await binding.prepare("INSERT INTO posts (id, user_id, title) VALUES (10, 1, 'Taken')").run();
    const user = db().model(User).build({ email: "a@example.com" });
    const post = user.posts().build({ id: 10, title: "Clash" });

    await expect(user.save()).rejects.toThrow(RecordNotUnique);

    expect(user.isPersisted()).toBe(true);
    expect(post.isNewRecord()).toBe(true);
  });

  test("an owner with nothing to change still saves its built records", async () => {
    const user = await db().model(User).createOrThrow({ email: "a@example.com" });
    const post = user.posts().build({ title: "Hello" });

    await user.saveOrThrow();

    expect(post.isPersisted()).toBe(true);
  });

  test("a built record saved on its own isn't saved again, and create doesn't autosave", async () => {
    const user = await db().model(User).createOrThrow({ email: "a@example.com" });
    const post = user.posts().build({ title: "Hello" });
    await post.saveOrThrow();
    await user.posts().createOrThrow({ title: "Created" });
    events.length = 0;

    await user.saveOrThrow();

    expect(events).toHaveLength(0);
    expect(await db().model(Post).count()).toBe(2);
  });

  test("in a batch, an owner autosaves when its key is known, and refuses when D1 would generate it", async () => {
    const database = db();
    const key = database.model(ApiKey).build({ label: "deploy" });
    key.accounts().build({ id: 1 });
    const user = database.model(User).build({ email: "a@example.com" });
    user.posts().build({ title: "Hello" });

    await database.batch([key.saveStatement()]);
    expect(await database.model(Account).count()).toBe(1);

    await expect(database.batch([user.saveStatement()])).rejects.toThrow(RecordNotSaved);
    expect(await database.model(User).count()).toBe(0);
  });
});
