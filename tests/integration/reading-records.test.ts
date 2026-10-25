import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { connect, Relation, type QueryEvent } from "../../src/index.ts";
import { User } from "../fixtures/models/user.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

describe("reading records", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.prepare("DELETE FROM users").run();
  });

  test("toArray returns every row as a record of its model", async () => {
    await binding
      .prepare("INSERT INTO users (id, email) VALUES (1, 'a@example.com'), (2, 'b@example.com')")
      .run();
    const db = connect(binding);

    const users = await db.model(User).toArray();

    expect(users.every((user) => user instanceof User)).toBe(true);
    const byId = users.toSorted((a, b) => a.id - b.id);
    expect(byId.map((user) => [user.id, user.email])).toEqual([
      [1, "a@example.com"],
      [2, "b@example.com"],
    ]);
  });

  test("a relation runs no query until a terminal operation, then exactly one", async () => {
    const queries: QueryEvent[] = [];
    const db = connect(binding, { onQuery: (event) => queries.push(event) });

    const relation = db.model(User).where({ email: "a@example.com" });
    expect(queries).toHaveLength(0);

    await relation.toArray();
    expect(queries).toHaveLength(1);
  });

  test("where filters by attribute equality without changing the relation it came from", async () => {
    await binding
      .prepare("INSERT INTO users (id, email) VALUES (1, 'a@example.com'), (2, 'b@example.com')")
      .run();
    const db = connect(binding);
    const all = db.model(User);

    const filtered = all.where({ email: "b@example.com" });

    expect((await filtered.toArray()).map((user) => user.id)).toEqual([2]);
    expect(await all.toArray()).toHaveLength(2);
  });

  test("a subclass reads records as instances of itself", async () => {
    class Admin extends User {}
    await binding.prepare("INSERT INTO users (id, email) VALUES (1, 'a@example.com')").run();

    const [admin] = await connect(binding).model(Admin).toArray();

    expect(admin).toBeInstanceOf(Admin);
    expect(admin?.email).toBe("a@example.com");
  });

  test("db.models gives request-bound relations for several models", async () => {
    await binding.prepare("INSERT INTO users (id, email) VALUES (1, 'a@example.com')").run();

    const models = connect(binding).models({ User });

    expect((await models.User.toArray()).map((user) => user.email)).toEqual(["a@example.com"]);
  });

  test("a relation isn't awaitable, so returning one from an async function never runs it", async () => {
    const queries: QueryEvent[] = [];
    const db = connect(binding, { onQuery: (event) => queries.push(event) });
    const build = async () => db.model(User).where({ email: "a@example.com" });

    const relation = await build();

    expect(relation).toBeInstanceOf(Relation);
    expect(queries).toHaveLength(0);
  });
});
