import { afterAll, beforeAll, describe, expect, test, vi } from "vite-plus/test";
import {
  batch,
  connect,
  IncompatibleRelation,
  Model,
  NoDatabase,
  sql,
  withDatabase,
  type QueryEvent,
} from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

// Level 1 reads the Worker's bindings from cloudflare:workers, which only exists inside a Worker;
// here it's this test's D1, set once the database exists.
const workers: { env: Record<string, unknown> } = { env: {} };
vi.mock("cloudflare:workers", () => workers);

class User extends Model({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
}) {
  static tableName = "users";
  static override binding = "DB";
  static withRole = this.scope((q, role: string) => q.where({ role }));
}

// A Model naming no binding: only a request's database (or an explicit one) can serve it.
class Unbound extends Model({ id: { type: "integer", null: false }, email: "string" }) {
  static tableName = "users";
}

// A Model on a binding this Worker doesn't have.
class Elsewhere extends Model({ id: { type: "integer", null: false } }) {
  static tableName = "users";
  static override binding = "LOGS";
}

let binding: TestDatabase;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ db: binding, dispose } = await createTestDatabase());
  workers.env = { DB: binding };
  await connect(binding)
    .model(User)
    .insertAll([
      { id: 1, email: "ada@example.com", role: "admin" },
      { id: 2, email: "grace@example.com", role: "editor" },
    ]);
});
afterAll(() => dispose());

describe("Product.find(id): a query started from a Model", () => {
  test("level 1: with no setup, a Model queries its binding", async () => {
    expect((await User.find(1)).email).toBe("ada@example.com");
    expect((await User.withRole("editor").first())?.id).toBe(2);
  });

  test("level 2: inside withDatabase, the request's database is used, with its onQuery", async () => {
    const events: QueryEvent[] = [];
    const request = connect(binding, { onQuery: (event) => events.push(event) });

    const found = await withDatabase(request, () => User.all().order({ id: "desc" }).first());

    expect(found?.role).toBe("editor");
    expect(events.map((event) => event.sql)).toEqual([
      expect.stringMatching(/^SELECT \* FROM "users"/),
    ]);
  });

  test("level 2 outside a Worker: the request's database serves a Model with no binding", async () => {
    await expect(Unbound.find(1)).rejects.toThrow(
      new NoDatabase(
        'No database for this query: its Model names no binding (static binding = "DB", in its base class). Wrap the code in withDatabase(connect(env.DB), …), or use db.model(Model)',
      ),
    );
    expect((await withDatabase(connect(binding), () => Unbound.find(2))).email).toBe(
      "grace@example.com",
    );
  });

  test("records loaded through a level keep using it: save() writes to the same database", async () => {
    const events: QueryEvent[] = [];
    await withDatabase(connect(binding, { onQuery: (event) => events.push(event) }), async () => {
      const user = await User.find(1);
      await user.update({ role: "owner" });
    });

    expect(events.map((event) => event.sql.split(" ")[0])).toEqual(["SELECT", "UPDATE"]);
    expect((await User.find(1)).role).toBe("owner");
  });

  test("level 3: an explicit db is always its own", async () => {
    const events: QueryEvent[] = [];
    const db = connect(binding, { onQuery: (event) => events.push(event) });

    await withDatabase(connect(binding), () => db.model(User).find(1));

    expect(events).toHaveLength(1);
  });

  test("a binding the Worker doesn't have says to check the Wrangler config", async () => {
    await expect(Elsewhere.find(1)).rejects.toThrow(
      new NoDatabase(
        "The binding LOGS isn't in this Worker's env; check d1_databases in your Wrangler config",
      ),
    );
  });
});

describe("batch([...]): atomic writes on the current database", () => {
  test("statements and records from a Model's statics are written together, on its database", async () => {
    const events: QueryEvent[] = [];
    const user = User.build({ id: 3, email: "linus@example.com", role: "guest" });

    const [, saved] = await withDatabase(
      connect(binding, { onQuery: (event) => events.push(event) }),
      () => batch([User.where({ id: 1 }).toUpdateAll({ role: "lead" }), user.toSave()]),
    );

    expect(saved.isPersisted()).toBe(true);
    expect((await User.find(1)).role).toBe("lead");
    expect(events).toHaveLength(2);
  });

  test("entries from two databases are refused, as db.batch refuses another's", async () => {
    const explicit = connect(binding);

    await expect(
      batch([User.toUpdateAll(sql`role = role`), explicit.model(User).toDeleteAll()]),
    ).rejects.toThrow(IncompatibleRelation);
  });
});
