import { describe, expect, test } from "vite-plus/test";
import { connect, Model } from "../../src/index.ts";

class User extends Model({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
}) {
  static tableName = "users";
}

// No D1 needed: these records are only built, never loaded or written.
const users = connect({} as never).model(User);

describe("record state without D1", () => {
  test("setting an attribute to undefined throws, like assign, instead of storing NULL", () => {
    const user = users.build({ email: "a@example.com" });

    expect(() => {
      user.role = undefined as never;
    }).toThrow(TypeError);
    expect(() => {
      user.role = undefined as never;
    }).toThrow(/"role".*null/);
    expect(user.role).toBeNull();
  });
});
