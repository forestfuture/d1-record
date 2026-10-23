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

  test("the next request's bookmark cookie is where its Session starts, so it reads the last request's write", async () => {
    const first = await withSession(get(), binding, async () => {
      await User.create({ id: 1, email: "ada@example.com" });
      return new Response("created");
    });
    const bookmark = bookmarkFrom(first);

    const next = await withSession(get({ cookie: `d1-bookmark=${bookmark}` }), binding, async () =>
      Response.json(await User.find(1)),
    );

    expect(starts).toEqual(["first-unconstrained", bookmark]);
    expect(await next.json()).toMatchObject({ email: "ada@example.com" });
    expect(bookmarkFrom(next)).toEqual(expect.any(String));
  });

  test("the request's other cookies are read past, and an empty bookmark is no bookmark", async () => {
    const ok = () => Promise.resolve(new Response("ok"));
    await withSession(get({ cookie: "theme=dark; d1-bookmark=abc=1 ; lang=en" }), binding, ok);
    await withSession(get({ cookie: "theme=dark; d1-bookmark=" }), binding, ok);

    expect(starts).toEqual(["abc=1", "first-unconstrained"]);
  });

  test("cookies fn sets are kept, the bookmark's added beside them", async () => {
    const response = await withSession(get(), binding, async () => {
      await User.count();
      const response = new Response("ok");
      response.headers.append("set-cookie", "theme=dark; Path=/");
      return response;
    });

    expect(response.headers.getSetCookie()).toEqual([
      "theme=dark; Path=/",
      expect.stringMatching(/^d1-bookmark=/),
    ]);
  });

  test("when fn sends no query, the request's bookmark is set again, or none when it had none", async () => {
    const ok = () => Promise.resolve(new Response("ok"));
    const again = await withSession(get({ cookie: "d1-bookmark=abc" }), binding, ok);
    const none = await withSession(get(), binding, ok);

    expect(again.headers.getSetCookie()).toEqual([
      "d1-bookmark=abc; Path=/; HttpOnly; Secure; SameSite=Lax",
    ]);
    expect(none.headers.getSetCookie()).toEqual([]);
  });
});

/** The bookmark a response's d1-bookmark cookie carries. */
function bookmarkFrom(response: Response): string | undefined {
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith("d1-bookmark="));
  return cookie?.slice("d1-bookmark=".length).split(";")[0];
}
