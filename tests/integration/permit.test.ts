import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  test,
} from "vite-plus/test";
import { connect, Model, UnknownAttribute } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

class User extends Model({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
  isActive: "boolean",
  age: "integer",
}) {
  static tableName = "users";
}

// Untrusted input, as a request gives it: only the named attributes reach a record (#82).
describe("Model.permit", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  const users = () => connect(binding).model(User);

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.prepare("DELETE FROM users").run();
  });

  test("keeps the named attributes and drops every other key", () => {
    const body = JSON.parse(
      '{"email":"ada@example.com","role":"admin","isActive":"on","token":"x"}',
    );

    expect(User.permit(body, "email", "isActive")).toEqual({
      email: "ada@example.com",
      isActive: "on",
    });
  });

  test("leaves out a named attribute the input doesn't have, and keeps a null", () => {
    expect(User.permit({ role: null }, "email", "role")).toEqual({ role: null });
  });

  test("reads only the input's own keys, so __proto__ and inherited keys never get through", () => {
    const body = JSON.parse('{"__proto__":{"role":"admin"},"email":"ada@example.com"}');
    const inherited = Object.create({ role: "admin" }) as object;

    expect(User.permit(body, "email", "role")).toEqual({ email: "ada@example.com" });
    expect(User.permit(inherited, "role")).toEqual({});
    expect(Object.getPrototypeOf(User.permit(body, "email"))).toBe(Object.prototype);
  });

  test("a name that isn't an attribute is UnknownAttribute", () => {
    expect(() => User.permit({}, "password" as never)).toThrow(
      new UnknownAttribute('User has no attribute "password"'),
    );
  });

  test("its result is typed as the named attributes, and goes straight into create", async () => {
    const body: unknown = JSON.parse(
      '{"email":"ada@example.com","isActive":"false","role":"admin"}',
    );
    const permitted = User.permit(body, "email", "isActive");
    expectTypeOf(permitted).toEqualTypeOf<{ email?: string; isActive?: boolean | null }>();

    const user = await users().create(permitted);

    expect([user.email, user.isActive, user.role]).toEqual(["ada@example.com", false, null]);
  });

  test("subclasses and an app's base class have it", () => {
    class Admin extends User {}

    expect(Admin.permit({ role: "x", age: 3 }, "role")).toEqual({ role: "x" });
  });
});
