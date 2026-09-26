import { describe, expect, test } from "vite-plus/test";
import { connect, Model } from "../../src/index.ts";

class User extends Model({
  id: { type: "integer", null: false },
  email: "string",
  role: "string",
}) {
  static tableName = "users";

  static {
    this.validates("email", { presence: true });
  }
}

// No D1 needed: validation without uniqueness never queries.
const users = connect({} as never).model(User);

describe("validations", () => {
  test("isValid reports a blank attribute, and re-checks from scratch each time", async () => {
    const user = users.build({ email: "   " });

    expect(await user.isValid()).toBe(false);
    expect(user.errors.get("email")).toEqual(["can't be blank"]);

    user.email = "a@example.com";
    expect(await user.isValid()).toBe(true);
    expect(user.errors.isEmpty()).toBe(true);
  });
});
