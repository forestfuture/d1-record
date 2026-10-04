import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { batch, connect, Model, modelFor, withDatabase, type QueryEvent } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

// An app's base class with an app-wide listener (#78), as application-record.ts would declare it.
const logged: QueryEvent[] = [];
class Base extends Model.Base {
  static override onQuery = (event: QueryEvent) => {
    logged.push(event);
  };
}
const ApplicationRecord = modelFor({}, Base);

class User extends ApplicationRecord({ id: { type: "integer", null: false }, email: "string" }) {
  static tableName = "users";
}
class Post extends ApplicationRecord({
  id: { type: "integer", null: false },
  userId: "integer",
  title: "string",
}) {
  static tableName = "posts";
}

// A Model that replaces the inherited listener with its own.
const quiet: QueryEvent[] = [];
class Quiet extends User {
  static override onQuery = (event: QueryEvent) => {
    quiet.push(event);
  };
}

let binding: TestDatabase;
let dispose: () => Promise<void>;
beforeAll(async () => ({ db: binding, dispose } = await createTestDatabase()));
afterAll(() => dispose());
beforeEach(() => {
  logged.length = 0;
  quiet.length = 0;
});

describe("an app-wide onQuery on the base class", () => {
  test("sees every statement of every Model built on it, with the Model's name, whichever database runs it", async () => {
    const db = connect(binding);

    await db.model(User).count();
    await withDatabase(connect(binding), () => Post.count());

    expect(logged.map(({ model, sql }) => [model, sql.split(" ")[0]])).toEqual([
      ["User", "SELECT"],
      ["Post", "SELECT"],
    ]);
    expect(logged[0]).toMatchObject({ params: [], durationMs: expect.any(Number) });
  });

  test("runs after a database's own listener, which sees the Model too", async () => {
    const order: string[] = [];
    const db = connect(binding, { onQuery: ({ model }) => order.push(`database: ${model}`) });
    const before = logged.length;

    await withDatabase(db, () => User.count());

    expect(order).toEqual(["database: User"]);
    expect(logged.length - before).toBe(1);
  });

  test("a Model's own replaces the inherited one, as any static does", async () => {
    await connect(binding).model(Quiet).count();

    expect([logged.length, quiet.length]).toEqual([0, 1]);
  });

  test("in a batch, each statement reports its own Model", async () => {
    await withDatabase(connect(binding), () =>
      batch([User.where({ id: 0 }).toDeleteAll(), Post.where({ id: 0 }).toDeleteAll()]),
    );

    expect(logged.map(({ model }) => model)).toEqual(["User", "Post"]);
  });

  test("a failed statement is reported with its error", async () => {
    await expect(connect(binding).model(User).insert({ id: 1, email: null })).rejects.toThrow();

    expect(logged.at(-1)).toMatchObject({ model: "User", error: expect.any(Error) });
  });
});
