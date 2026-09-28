import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  column,
  connect,
  IncompatibleRelation,
  InvalidForeignKey,
  Model,
  NotNullViolation,
  RecordNotSaved,
  RecordNotUnique,
  UnknownAttribute,
  type HasMany,
  type QueryEvent,
  sql,
} from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

const log: string[] = [];

class User extends Model({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
  age: "integer",
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

  static associations = this.defineAssociations({
    comments: this.hasMany(() => Comment, { foreignKey: "postId" }),
  });

  declare comments: HasMany<typeof Comment>;
}

class Comment extends Model({
  id: { type: "integer", null: false },
  postId: "integer",
  body: "string",
}) {
  static tableName = "comments";
}

let counter = 0;

class ApiKey extends Model({
  id: { type: "string", null: false, default: () => `key-${++counter}` },
  label: { type: "string", null: false },
  scopes: "json",
}) {
  static tableName = "api_keys";
}

class Account extends Model({
  id: { type: "integer", null: false },
  externalAccountId: "string",
}) {
  static tableName = "accounts";
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
      binding.prepare("DELETE FROM comments"),
      binding.prepare("DELETE FROM posts"),
      binding.prepare("DELETE FROM users"),
      binding.prepare("DELETE FROM api_keys"),
      binding.prepare("DELETE FROM accounts"),
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

  describe("updateAll and deleteAll", () => {
    async function seedUsers(db: ReturnType<typeof connect>): Promise<void> {
      for (const [id, role] of [
        [1, "admin"],
        [2, "member"],
        [3, "member"],
        [4, "member"],
      ] as const) {
        await db
          .model(User)
          .insert({ id, email: `u${id}@example.com`, role, age: 20 })
          .run();
      }
    }

    async function roles(db: ReturnType<typeof connect>): Promise<unknown[]> {
      return db.model(User).order({ id: "asc" }).pluck("id", "role");
    }

    test("updateAll sets attributes on the matching rows and resolves to D1's meta", async () => {
      const db = connect(binding);
      await seedUsers(db);

      const meta = await db
        .model(User)
        .where({ role: "member" })
        .updateAll({ role: "guest" })
        .run();

      expect(meta.changes).toBe(3);
      expect(await roles(db)).toEqual([
        [1, "admin"],
        [2, "guest"],
        [3, "guest"],
        [4, "guest"],
      ]);
      expect(log).toEqual([]);
    });

    test("updateAll leaves updatedAt alone, as in Rails", async () => {
      const db = connect(binding);
      await db.model(User).insert({ id: 1, email: "a@example.com" }).run();
      await db
        .model(Post)
        .insert({ id: 1, userId: 1, title: "Old", published: false, updatedAt: past })
        .run();

      await db.model(Post).updateAll({ title: "New", published: true }).run();

      const post = await db.model(Post).find(1);
      expect([post.title, post.published, post.updatedAt]).toEqual(["New", true, past]);
    });

    test("updateAll takes an sql fragment for changes that refer to columns", async () => {
      const db = connect(binding);
      await seedUsers(db);

      await db
        .model(User)
        .where({ id: [1, 2] })
        .updateAll(sql`${column("age")} = ${column("age")} + ${1}`)
        .run();

      expect(await db.model(User).order({ id: "asc" }).pluck("age")).toEqual([21, 21, 20, 20]);
    });

    test("updateAll refuses no changes, unknown attributes, undefined and plain strings", () => {
      const users = connect(binding).model(User);

      expect(() => users.updateAll({})).toThrow(TypeError);
      expect(() => users.updateAll({ nope: 1 } as never)).toThrow(UnknownAttribute);
      expect(() => users.updateAll({ role: undefined })).toThrow(TypeError);
      expect(() => users.updateAll("role = 'x'" as never)).toThrow(TypeError);
    });

    test("deleteAll deletes the matching rows", async () => {
      const db = connect(binding);
      await seedUsers(db);

      const meta = await db.model(User).where({ role: "member" }).deleteAll().run();

      expect(meta.changes).toBe(3);
      expect(await roles(db)).toEqual([[1, "admin"]]);
    });

    test("with limit and offset, only the rows of that page are changed, in the Relation's order", async () => {
      const db = connect(binding);
      await seedUsers(db);

      await db.model(User).order({ id: "desc" }).limit(2).deleteAll().run();
      await db.model(User).order({ id: "asc" }).offset(1).limit(1).updateAll({ role: "x" }).run();

      expect(await roles(db)).toEqual([
        [1, "admin"],
        [2, "x"],
      ]);
    });

    test("a fragment order with values picks the page's rows, its values bound in order", async () => {
      const db = connect(binding);
      await seedUsers(db);
      const page = db
        .model(User)
        .where({ age: 20 })
        .order(sql`${column("role")} = ${"admin"} DESC`)
        .order({ id: "desc" })
        .limit(2);

      await page.updateAll({ role: "x" }).run();
      expect(await roles(db)).toEqual([
        [1, "x"],
        [2, "member"],
        [3, "member"],
        [4, "x"],
      ]);

      await db
        .model(User)
        .where({ age: 20 })
        .order(sql`${column("id")} = ${3} DESC`)
        .limit(1)
        .deleteAll()
        .run();
      expect(await db.model(User).order({ id: "asc" }).pluck("id")).toEqual([1, 2, 4]);
    });

    test("select, includes and an order without a limit don't change which rows are written", async () => {
      const db = connect(binding);
      await seedUsers(db);

      await db
        .model(User)
        .where({ role: "member" })
        .select("email")
        .order({ id: "desc" })
        .deleteAll()
        .run();
      await db.model(User).includes("posts").updateAll({ role: "owner" }).run();

      expect(await roles(db)).toEqual([[1, "owner"]]);
    });

    test("distinct can't be written through", () => {
      const users = connect(binding).model(User).select("role").distinct();

      expect(() => users.deleteAll()).toThrow(IncompatibleRelation);
      expect(() => users.updateAll({ role: "x" })).toThrow(IncompatibleRelation);
    });

    test("a none() statement is still sent, matches nothing, and reports no changes", async () => {
      const events: QueryEvent[] = [];
      const db = connect(binding, { onQuery: (event) => events.push(event) });
      await seedUsers(db);
      events.length = 0;

      const deleted = await db.model(User).none().deleteAll().run();
      const updated = await db.model(User).none().updateAll({ role: "x" }).run();

      expect([deleted.changes, updated.changes]).toEqual([0, 0]);
      expect(events).toHaveLength(2);
      expect(await db.model(User).count()).toBe(4);
    });

    describe("through a hasMany", () => {
      async function seedComments(db: ReturnType<typeof connect>): Promise<void> {
        await db.model(User).insert({ id: 1, email: "a@example.com" }).run();
        await db.model(Post).insert({ id: 1, userId: 1, title: "A", published: true }).run();
        await db.model(Post).insert({ id: 2, userId: 1, title: "B", published: false }).run();
        await db.model(Comment).insert({ id: 1, postId: 1, body: "one" }).run();
        await db.model(Comment).insert({ id: 2, postId: 1, body: "two" }).run();
        await db.model(Comment).insert({ id: 3, postId: 2, body: "three" }).run();
      }

      async function comments(db: ReturnType<typeof connect>): Promise<unknown[]> {
        return db.model(Comment).order({ id: "asc" }).pluck("id", "postId");
      }

      test("deleteAll on the association nullifies the foreign key, as Rails' has_many does", async () => {
        const db = connect(binding);
        await seedComments(db);
        const post = await db.model(Post).find(1);

        await post.comments().deleteAll().run();

        expect(await comments(db)).toEqual([
          [1, null],
          [2, null],
          [3, 2],
        ]);
      });

      test("…so a NOT NULL foreign key raises instead of losing rows", async () => {
        const db = connect(binding);
        await seedComments(db);
        const user = await db.model(User).find(1);

        await expect(user.posts().deleteAll().run()).rejects.toThrow(NotNullViolation);
        expect(await db.model(Post).count()).toBe(2);
      });

      test("once the association is narrowed, deleteAll deletes, as a Rails association relation does", async () => {
        const db = connect(binding);
        await seedComments(db);
        const post = await db.model(Post).find(1);

        await post.comments().where({ body: "one" }).deleteAll().run();

        expect(await comments(db)).toEqual([
          [2, 1],
          [3, 2],
        ]);
      });

      test("updateAll on the association updates its records only", async () => {
        const db = connect(binding);
        await seedComments(db);
        const post = await db.model(Post).find(1);

        await post.comments().updateAll({ body: "edited" }).run();

        expect(await db.model(Comment).order({ id: "asc" }).pluck("body")).toEqual([
          "edited",
          "edited",
          "three",
        ]);
      });

      test("the association of an unsaved owner changes nothing", async () => {
        const db = connect(binding);
        await seedComments(db);
        const post = db.model(Post).build({ title: "New" });

        expect((await post.comments().deleteAll().run()).changes).toBe(0);
        expect((await post.comments().updateAll({ body: "x" }).run()).changes).toBe(0);
        expect(await comments(db)).toEqual([
          [1, 1],
          [2, 1],
          [3, 2],
        ]);
      });
    });
  });

  describe("insertAll, and skipping or updating duplicates", () => {
    const post = (id: number, title: string) => ({ id, userId: 1, title, published: false });

    beforeEach(async () => {
      await connect(binding).model(User).insert({ id: 1, email: "a@example.com" }).run();
    });

    test("insertAll writes every row in one statement, converting values and applying defaults per row", async () => {
      const events: QueryEvent[] = [];
      const db = connect(binding, { onQuery: (event) => events.push(event) });

      const meta = await db
        .model(ApiKey)
        .insertAll([
          { label: "deploy", scopes: ["read"] },
          { label: "release", scopes: null },
        ])
        .run();

      expect(meta.changes).toBe(2);
      expect(events).toHaveLength(1);
      const keys = await db.model(ApiKey).order({ label: "asc" }).toArray();
      expect(keys.map((key) => [key.label, key.scopes])).toEqual([
        ["deploy", ["read"]],
        ["release", null],
      ]);
      expect(new Set(keys.map((key) => key.id)).size).toBe(2);
    });

    test("datetime values are converted like any write", async () => {
      await connect(binding)
        .model(Post)
        .insertAll([{ ...post(1, "A"), createdAt: past }])
        .run();

      expect((await connect(binding).model(Post).find(1)).createdAt).toEqual(past);
    });

    test("createdAt and updatedAt are set on every row, as Rails' insert_all does", async () => {
      const before = Date.now();

      await connect(binding)
        .model(Post)
        .insertAll([post(1, "A"), post(2, "B")])
        .run();

      const stamps = await connect(binding).model(Post).pluck("createdAt", "updatedAt");
      expect(stamps.flat().every((stamp) => stamp!.getTime() >= before)).toBe(true);
    });

    test("any number of rows fits in one statement, beyond D1's 100 bound parameters", async () => {
      const rows = Array.from({ length: 150 }, (_, index) => post(index + 1, `Post ${index + 1}`));

      await connect(binding).model(Post).insertAll(rows).run();

      expect(await connect(binding).model(Post).count()).toBe(150);
    });

    test("a duplicate throws, and the statement writes nothing", async () => {
      const posts = connect(binding).model(Post);
      await posts.insert(post(1, "A")).run();

      await expect(posts.insertAll([post(2, "B"), post(1, "Again")]).run()).rejects.toThrow(
        RecordNotUnique,
      );
      expect(await posts.pluck("title")).toEqual(["A"]);
    });

    test("onDuplicate: skip leaves existing rows alone and writes the rest", async () => {
      const posts = connect(binding).model(Post);
      await posts.insert(post(1, "A")).run();

      const meta = await posts
        .insertAll([post(1, "Again"), post(2, "B")], { onDuplicate: "skip" })
        .run();
      await posts.insert(post(2, "Again"), { onDuplicate: "skip" }).run();

      expect(meta.changes).toBe(1);
      expect(await posts.order({ id: "asc" }).pluck("title")).toEqual(["A", "B"]);
    });

    test("upsert inserts new rows and updates existing ones by primary key, keeping createdAt", async () => {
      const posts = connect(binding).model(Post);
      await posts.insert({ ...post(1, "A"), createdAt: past, updatedAt: past }).run();
      const before = Date.now();

      await posts.upsert({ ...post(1, "A2"), published: true }).run();
      await posts.upsertAll([post(2, "B")]).run();

      const updated = await posts.find(1);
      expect([updated.title, updated.published, updated.createdAt]).toEqual(["A2", true, past]);
      expect(updated.updatedAt!.getTime()).toBeGreaterThanOrEqual(before);
      expect(await posts.order({ id: "asc" }).pluck("title")).toEqual(["A2", "B"]);
    });

    test("uniqueBy names another unique index to match on", async () => {
      const users = connect(binding).model(User);

      await users
        .upsertAll(
          [
            { email: "a@example.com", role: "admin" },
            { email: "b@example.com", role: "member" },
          ],
          {
            uniqueBy: "email",
          },
        )
        .run();

      expect(await users.order({ email: "asc" }).pluck("id", "role")).toEqual([
        [1, "admin"],
        [expect.any(Number), "member"],
      ]);
    });

    test("upsert only updates the attributes it was given, never filled-in defaults or the key", async () => {
      class Member extends Model({
        id: { type: "integer", null: false, default: () => 999 },
        email: { type: "string", null: false },
        role: { type: "string", default: () => "member" },
      }) {
        static tableName = "users";
      }
      const members = connect(binding).model(Member);
      await members.insert({ id: 2, email: "b@example.com", role: "admin" }).run();

      await members.upsert({ email: "b@example.com" }, { uniqueBy: "email" }).run();

      expect(await members.where({ email: "b@example.com" }).pluck("id", "role")).toEqual([
        [2, "admin"],
      ]);
    });

    test("upsert matches on the primary key by default, even when it isn't given", async () => {
      const posts = connect(binding).model(Post);
      await posts.insert(post(1, "A")).run();

      await posts.upsert({ userId: 1, title: "B", published: false }).run();

      expect(await posts.order({ id: "asc" }).pluck("title")).toEqual(["A", "B"]);
    });

    test("rows are compared as given, in any key order", () => {
      const posts = connect(binding).model(Post);

      expect(() =>
        posts.insertAll([
          { id: 1, userId: 1, title: "A", published: false },
          { published: true, title: "B", userId: 1, id: 2 },
        ]),
      ).not.toThrow();
      expect(() =>
        posts.insertAll([{ ...post(1, "A"), createdAt: past }, { ...post(2, "B") }]),
      ).toThrow(TypeError);
    });

    test("with nothing to insert, a skip, an upsert or several rows throw; insert({}) writes defaults", async () => {
      class Bare extends Model({ id: { type: "integer", null: false } }) {
        static tableName = "comments";
      }
      const bare = connect(binding).model(Bare);

      expect(() => bare.insert({}, { onDuplicate: "skip" })).toThrow(TypeError);
      expect(() => bare.upsert({})).toThrow(TypeError);
      expect(() => bare.insertAll([{}, {}])).toThrow(TypeError);
      expect((await bare.insert({}).run()).changes).toBe(1);
    });

    test("rows must share their attributes; an empty list and unknown attributes throw", () => {
      const posts = connect(binding).model(Post);

      expect(() => posts.insertAll([post(1, "A"), { id: 2, userId: 1, title: "B" }])).toThrow(
        TypeError,
      );
      expect(() => posts.insertAll([])).toThrow(TypeError);
      expect(() => posts.upsertAll([post(1, "A")], { uniqueBy: "nope" as never })).toThrow(
        UnknownAttribute,
      );
    });

    test("through an association, every row gets the owner's key, and it can go in a batch", async () => {
      const db = connect(binding);
      const user = await db.model(User).find(1);

      await db.batch([
        user.posts().insertAll([
          { id: 1, title: "A", published: true },
          { id: 2, title: "B", published: false },
        ]),
      ]);

      expect(await user.posts().pluck("title")).toEqual(["A", "B"]);
    });
  });

  describe("db.batch", () => {
    test("runs the statements in order, atomically, and resolves to each one's meta", async () => {
      const db = connect(binding);
      const userId = 7;

      const metas = await db.batch([
        db.model(User).insert({ id: userId, email: "a@example.com", role: "member" }),
        db.model(Post).insert({ userId, title: "Hello", published: true }),
        db.model(User).where({ id: userId }).updateAll({ role: "author" }),
      ]);

      expect(metas.map((meta) => meta.changes)).toEqual([1, 1, 1]);
      const user = await db.model(User).find(userId);
      expect(user.role).toBe("author");
      expect(await user.posts().pluck("title")).toEqual(["Hello"]);
    });

    test("ids generated in code link rows inside one batch", async () => {
      const db = connect(binding);
      const keyId = crypto.randomUUID();

      await db.batch([
        db.model(ApiKey).insert({ id: keyId, label: "deploy" }),
        db.model(Account).insert({ externalAccountId: keyId }),
      ]);

      const account = await db.model(Account).findByOrThrow({ externalAccountId: keyId });
      expect((await db.model(ApiKey).find(account.externalAccountId!)).label).toBe("deploy");
    });

    test("a failing statement rolls the whole batch back and throws its ConstraintViolation", async () => {
      const db = connect(binding);
      await db.model(User).insert({ id: 1, email: "a@example.com" }).run();

      const error: unknown = await db
        .batch([
          db.model(User).insert({ id: 2, email: "b@example.com" }),
          db.model(Post).insert({ userId: 2, title: "Hello", published: true }),
          db.model(User).insert({ id: 3, email: "a@example.com" }),
        ])
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(RecordNotUnique);
      expect(error).toMatchObject({ table: "users", columns: ["email"], attributes: ["email"] });
      expect(await db.model(User).pluck("id")).toEqual([1]);
      expect(await db.model(Post).count()).toBe(0);
    });

    test("a constraint D1 doesn't name a table for is the batch's Model if it has only one", async () => {
      const db = connect(binding);

      const error: unknown = await db
        .batch([db.model(Post).insert({ userId: 99, title: "Orphan", published: true })])
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(InvalidForeignKey);
      expect(error).toMatchObject({ table: "posts" });
    });

    test("…and no table when the batch writes to several", async () => {
      const db = connect(binding);

      const error: unknown = await db
        .batch([
          db.model(User).insert({ id: 1, email: "a@example.com" }),
          db.model(Post).insert({ userId: 99, title: "Orphan", published: true }),
        ])
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(InvalidForeignKey);
      expect(error).toMatchObject({ table: null, columns: [], attributes: [] });
      expect((error as Error).message).toMatch(/^batch: /);
    });

    test("a constraint on a table the batch doesn't write to isn't pinned on the batch's Model", async () => {
      const db = connect(binding);
      await db.model(User).insert({ id: 1, email: "taken@example.com" }).run();
      // A trigger makes inserting a post also insert a user with a taken email.
      await binding
        .prepare(
          "CREATE TRIGGER post_signs_up AFTER INSERT ON posts BEGIN INSERT INTO users (email) VALUES ('taken@example.com'); END",
        )
        .run();

      try {
        const error: unknown = await db
          .batch([db.model(Post).insert({ userId: 1, title: "Hello", published: true })])
          .catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(RecordNotUnique);
        expect(error).toMatchObject({ table: "users", columns: ["email"], attributes: [] });
      } finally {
        await binding.prepare("DROP TRIGGER post_signs_up").run();
      }
    });

    test("onQuery hears once per statement, with D1's meta for each", async () => {
      const events: QueryEvent[] = [];
      const db = connect(binding, { onQuery: (event) => events.push(event) });

      await db.batch([
        db.model(User).insert({ id: 1, email: "a@example.com" }),
        db.model(User).where({ id: 1 }).deleteAll(),
      ]);

      expect(events.map((event) => event.meta?.changes)).toEqual([1, 1]);
      expect(events.every((event) => event.durationMs >= 0 && event.error === undefined)).toBe(
        true,
      );
    });

    test("…and when the batch fails, every statement is reported with the error", async () => {
      const events: QueryEvent[] = [];
      const db = connect(binding, { onQuery: (event) => events.push(event) });

      await db
        .batch([
          db.model(User).insert({ id: 1, email: "a@example.com" }),
          db.model(User).insert({ id: 2, email: "a@example.com" }),
        ])
        .catch(() => undefined);

      expect(events).toHaveLength(2);
      expect(events.every((event) => event.error !== undefined && event.meta === undefined)).toBe(
        true,
      );
    });

    test("an empty batch sends nothing", async () => {
      const events: QueryEvent[] = [];
      const db = connect(binding, { onQuery: (event) => events.push(event) });

      expect(await db.batch([])).toEqual([]);
      expect(events).toEqual([]);
    });

    test("statements built on another Database are refused", async () => {
      const db = connect(binding);
      const other = connect(binding);

      await expect(
        db.batch([other.model(User).insert({ email: "a@example.com" })]),
      ).rejects.toThrow(IncompatibleRelation);
      expect(await db.model(User).count()).toBe(0);
    });
  });
});
