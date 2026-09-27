import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  connect,
  Model,
  RecordNotSaved,
  RecordNotUnique,
  UnknownAttribute,
  type HasMany,
  type QueryEvent,
} from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

const log: string[] = [];

class User extends Model({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
}) {
  static tableName = "users";

  static associations = this.defineAssociations({
    posts: this.hasMany(() => Post, { foreignKey: "userId" }),
  });

  declare posts: HasMany<typeof Post>;

  static {
    this.validates("role", { presence: true });
    this.beforeSave(() => void log.push("beforeSave"));
    this.afterCreate(() => void log.push("afterCreate"));
  }
}

class Post extends Model({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
  published: { type: "boolean", null: false },
  createdAt: "datetime",
  updatedAt: "datetime",
}) {
  static tableName = "posts";
}

let counter = 0;

class ApiKey extends Model({
  id: { type: "string", null: false, default: () => `key-${++counter}` },
  label: { type: "string", null: false },
  scopes: "json",
}) {
  static tableName = "api_keys";
}

const past = new Date(Date.UTC(2020, 0, 1));

describe("statements", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    log.length = 0;
    await binding.batch([
      binding.prepare("DELETE FROM posts"),
      binding.prepare("DELETE FROM users"),
      binding.prepare("DELETE FROM api_keys"),
    ]);
  });

  describe("insert", () => {
    test("run() writes the row and resolves to D1's meta, skipping validations and callbacks", async () => {
      const db = connect(binding);

      const meta = await db.model(User).insert({ id: 1, email: "a@example.com" }).run();

      expect(meta.changes).toBe(1);
      expect(log).toEqual([]);
      const user = await db.model(User).find(1);
      expect(user.email).toBe("a@example.com");
      expect(user.role).toBeNull(); // presence validation skipped
    });

    test("building a statement doesn't query; attribute values are converted when it's built", async () => {
      const events: QueryEvent[] = [];
      const db = connect(binding, { onQuery: (event) => events.push(event) });

      const statement = db.model(ApiKey).insert({ label: "deploy", scopes: ["read"] });
      expect(events).toEqual([]);
      await statement.run();

      expect(events).toHaveLength(1);
      const key = await db.model(ApiKey).findByOrThrow({ label: "deploy" });
      expect(key.scopes).toEqual(["read"]);
    });

    test("declared defaults fill attributes that weren't given, like app-generated keys", async () => {
      const db = connect(binding);

      await db.model(ApiKey).insert({ label: "deploy" }).run();
      await db.model(ApiKey).insert({ id: "mine", label: "release" }).run();

      expect(await db.model(ApiKey).order({ label: "asc" }).pluck("id")).toEqual([
        `key-${counter}`,
        "mine",
      ]);
    });

    test("createdAt and updatedAt are set to now, unless given", async () => {
      const db = connect(binding);
      await db.model(User).insert({ id: 1, email: "a@example.com" }).run();
      const before = Date.now();

      await db.model(Post).insert({ id: 1, userId: 1, title: "Now", published: false }).run();
      await db
        .model(Post)
        .insert({ id: 2, userId: 1, title: "Then", published: false, createdAt: past })
        .run();

      const now = await db.model(Post).find(1);
      const then = await db.model(Post).find(2);
      expect(now.createdAt?.getTime()).toBeGreaterThanOrEqual(before);
      expect(now.updatedAt).toEqual(now.createdAt);
      expect(then.createdAt).toEqual(past);
      expect(then.updatedAt?.getTime()).toBeGreaterThanOrEqual(before);
    });

    test("a Relation's equality conditions are inserted too, as build() uses them", async () => {
      const db = connect(binding);
      await db.model(User).insert({ id: 1, email: "a@example.com" }).run();
      const user = await db.model(User).find(1);

      await user.posts().insert({ title: "Hello", published: true }).run();
      await db.model(Post).where({ userId: 1, published: false }).insert({ title: "Draft" }).run();

      expect(await user.posts().order({ id: "asc" }).pluck("title", "published")).toEqual([
        ["Hello", true],
        ["Draft", false],
      ]);
    });

    test("inserting through the posts of an unsaved user throws RecordNotSaved", () => {
      const user = connect(binding).model(User).build({ email: "a@example.com" });

      expect(() => user.posts().insert({ title: "Hello" })).toThrow(RecordNotSaved);
    });

    test("unknown attributes and undefined values throw when the statement is built", () => {
      const users = connect(binding).model(User);

      expect(() => users.insert({ nope: 1 } as never)).toThrow(UnknownAttribute);
      expect(() => users.insert({ email: undefined } as never)).toThrow(TypeError);
    });

    test("a constraint failure throws the matching ConstraintViolation", async () => {
      const users = connect(binding).model(User);
      await users.insert({ id: 1, email: "a@example.com" }).run();

      await expect(users.insert({ id: 2, email: "a@example.com" }).run()).rejects.toThrow(
        RecordNotUnique,
      );
    });

    test("a statement isn't awaitable, so returning one from an async function doesn't run it", async () => {
      const events: QueryEvent[] = [];
      const db = connect(binding, { onQuery: (event) => events.push(event) });

      const statement = await (async () => db.model(User).insert({ email: "a@example.com" }))();

      expect("then" in statement).toBe(false);
      expect(events).toEqual([]);
      expect(await db.model(User).count()).toBe(0);
    });
  });
});
