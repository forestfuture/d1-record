import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { Model, withSession } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

class User extends Model({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static tableName = "users";
}

let database: TestDatabase;
let dispose: () => Promise<void>;
/** What each Session this test's binding opened started from. */
let starts: (string | undefined)[];
let binding: TestDatabase;

beforeAll(async () => {
  ({ db: database, dispose } = await createTestDatabase());
});
afterAll(() => dispose());
beforeEach(async () => {
  await database.prepare("DELETE FROM users").run();
  starts = [];
  binding = new Proxy(database, {
    get(object, key) {
      if (key === "withSession") {
        return (constraint?: string) => {
          starts.push(constraint);
          return object.withSession(constraint);
        };
      }
      const value: unknown = Reflect.get(object, key);
      return typeof value === "function" ? value.bind(object) : value;
    },
  });
});

function get(headers: Record<string, string> = {}): Request {
  return new Request("https://example.com/posts", { headers });
}

describe("withSession(request, env.DB, fn)", () => {
  test("with no bookmark, starts first-unconstrained, runs fn as the request's database, and sets the bookmark cookie", async () => {
    const response = await withSession(get(), binding, async () => {
      await User.create({ id: 1, email: "ada@example.com" });
      return new Response("ok");
    });

    expect(starts).toEqual(["first-unconstrained"]);
    expect(await response.text()).toBe("ok");
    expect(response.headers.getSetCookie()).toEqual([
      expect.stringMatching(/^d1-bookmark=[^;]+; Path=\/; HttpOnly; Secure; SameSite=Lax$/),
    ]);
  });
});
