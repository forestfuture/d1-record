import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  CheckViolation,
  connect,
  InvalidForeignKey,
  Model,
  NotNullViolation,
  RecordNotUnique,
  type HasMany,
  type QueryEvent,
} from "../../src/index.ts";
import { configured, remoteDatabase, type RemoteDatabase } from "./support.ts";

/** The fixture Models, on this run's prefixed tables. */
function modelsFor(prefix: string) {
  class User extends Model({
    id: { type: "integer", null: false },
    email: { type: "string", null: false },
    role: "string",
    settings: "json",
    createdAt: "datetime",
    updatedAt: "datetime",
  }) {
    static tableName = `${prefix}users`;

    static associations = this.defineAssociations({
      posts: this.hasMany(() => Post, { foreignKey: "userId" }),
    });

    declare posts: HasMany<typeof Post>;
  }

  class Post extends Model({
    id: { type: "integer", null: false },
    userId: { type: "integer", null: false },
    title: { type: "string", null: false },
    published: { type: "boolean", null: false },
    views: { type: "integer", null: false },
  }) {
    static tableName = `${prefix}posts`;
  }

  return { User, Post };
}

// Against a real remote D1: catches what Miniflare's local D1 can't show, such as error message
// formats, `meta` fields, D1's limits and Sessions. Skipped unless configured (see support.ts).
describe.skipIf(!configured)("remote D1 smoke", () => {
  let remote: RemoteDatabase;
  let User: ReturnType<typeof modelsFor>["User"];
  let Post: ReturnType<typeof modelsFor>["Post"];

  beforeAll(async () => {
    remote = await remoteDatabase();
    ({ User, Post } = modelsFor(remote.prefix));
  });
  afterAll(() => remote?.dispose());
  beforeEach(async () => {
    const db = connect(remote.binding);
    await db.batch([db.model(Post).deleteAll(), db.model(User).deleteAll()]);
  });

  test("create, find, update and destroy a record, with values converted both ways", async () => {
    const db = connect(remote.binding);
    const created = await db
      .model(User)
      .createOrThrow({ email: "a@example.com", settings: { theme: "dark" } });

    const found = await db.model(User).find(created.id);
    expect(found.settings).toEqual({ theme: "dark" });
    expect(found.createdAt).toBeInstanceOf(Date);

    await found.updateOrThrow({ role: "admin" });
    expect((await db.model(User).find(created.id)).role).toBe("admin");

    await found.destroyOrThrow();
    expect(await db.model(User).count()).toBe(0);
  });

  test("onQuery and run() get D1's meta, with the fields the contract relies on", async () => {
    const events: QueryEvent[] = [];
    const db = connect(remote.binding, { onQuery: (event) => events.push(event) });

    const meta = await db.model(User).insert({ id: 1, email: "a@example.com" }).run();

    expect(meta).toMatchObject({ changes: 1, last_row_id: 1 });
    expect(typeof meta.duration).toBe("number");
    expect(events).toHaveLength(1);
    expect(events[0]?.meta?.changes).toBe(1);
  });

  describe("constraint errors: D1's message formats", () => {
    test("UNIQUE names the table, column and attribute", async () => {
      const users = connect(remote.binding).model(User);
      await users.createOrThrow({ email: "a@example.com" });

      const error: unknown = await users
        .createOrThrow({ email: "a@example.com" })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(RecordNotUnique);
      expect(error).toMatchObject({
        table: `${remote.prefix}users`,
        columns: ["email"],
        attributes: ["email"],
      });
    });

    test("NOT NULL, FOREIGN KEY and CHECK", async () => {
      const db = connect(remote.binding);
      const user = await db.model(User).createOrThrow({ email: "a@example.com" });

      const notNull = db.model(Post).insert({ userId: user.id, title: null as never });
      const foreignKey = db.model(Post).insert({ userId: 999_999, title: "Orphan" });
      const check = db.model(Post).insert({ userId: user.id, title: "Hello", views: -1 });

      await expect(notNull.run()).rejects.toThrow(NotNullViolation);
      await expect(foreignKey.run()).rejects.toThrow(InvalidForeignKey);
      await expect(check.run()).rejects.toThrow(CheckViolation);
    });
  });

  test("a failing batch rolls back completely", async () => {
    const db = connect(remote.binding);

    const error: unknown = await db
      .batch([
        db.model(User).insert({ id: 1, email: "a@example.com" }),
        db.model(Post).insert({ userId: 1, title: "Hello" }),
        db.model(User).insert({ id: 2, email: "a@example.com" }),
      ])
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RecordNotUnique);
    expect(await db.model(User).count()).toBe(0);
    expect(await db.model(Post).count()).toBe(0);
  });

  // With read replication on (see docs/agents/remote-smoke.md), "first-unconstrained" lets reads
  // go to a replica, so only the Session keeps them consistent with the writes.
  test("a session reads its own writes, and its bookmark carries them to the next request", async () => {
    const first = connect(remote.binding, { session: "first-unconstrained" });
    const user = await first.model(User).createOrThrow({ email: "a@example.com" });
    await user.updateOrThrow({ role: "admin" });
    await user.reload();
    expect(user.role).toBe("admin");

    const bookmark = first.bookmark();
    expect(typeof bookmark).toBe("string");

    const next = connect(remote.binding, { session: bookmark! });
    // Starting from the bookmark, a replica read waits until it has caught up with the write.
    expect((await next.model(User).find(user.id)).role).toBe("admin");
  });

  test("insertAll binds its rows as one JSON value, and upsert updates on conflict", async () => {
    const db = connect(remote.binding);
    const users = db.model(User);

    await users
      .insertAll([
        { id: 1, email: "a@example.com", settings: { theme: "dark" } },
        { id: 2, email: "b@example.com", settings: null },
      ])
      .run();
    await users.upsertAll([{ id: 1, email: "a@example.com", role: "admin" }]).run();
    const skipped = await users
      .insert({ id: 2, email: "b@example.com" }, { onDuplicate: "skip" })
      .run();

    expect(skipped.changes).toBe(0);
    expect(await users.order({ id: "asc" }).pluck("role", "settings")).toEqual([
      ["admin", { theme: "dark" }],
      [null, null],
    ]);
  });

  test("preloading more than 100 owners stays within D1's 100 bound parameters", async () => {
    const db = connect(remote.binding);
    const ids = Array.from({ length: 150 }, (_, index) => index + 1);
    // In batches of 25, under D1's per-invocation query limit (50 on the Free plan).
    for (let start = 0; start < ids.length; start += 25) {
      const group = ids.slice(start, start + 25);
      await db.batch(group.map((id) => db.model(User).insert({ id, email: `u${id}@example.com` })));
      await db.batch(group.map((id) => db.model(Post).insert({ userId: id, title: `Post ${id}` })));
    }

    const users = await db.model(User).includes("posts").toArray();

    expect(users).toHaveLength(150);
    expect(users.every((user) => user.loaded("posts").length === 1)).toBe(true);
  });
});
