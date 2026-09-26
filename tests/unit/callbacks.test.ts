import { describe, expect, test } from "vite-plus/test";
import { connect, Model } from "../../src/index.ts";

const log: string[] = [];

class User extends Model({
  id: { type: "integer", null: false },
  email: "string",
}) {
  static tableName = "users";

  static {
    this.beforeValidation((user) => {
      log.push("beforeValidation 1");
      user.email = user.email?.trim() ?? null;
    });
    this.beforeValidation(async () => {
      await Promise.resolve();
      log.push("beforeValidation 2");
    });
    this.validates("email", {
      presence: true,
      if: () => {
        log.push("validators");
        return true;
      },
    });
    this.afterValidation((user) => {
      log.push(`afterValidation (${user.errors.size} errors)`);
    });
  }
}

const users = connect({} as never).model(User);

describe("validation callbacks", () => {
  test("run before and after the validators, in declaration order, awaiting async ones", async () => {
    log.length = 0;
    const user = users.build({ email: "  a@example.com  " });

    expect(await user.isValid()).toBe(true);

    expect(log).toEqual([
      "beforeValidation 1",
      "beforeValidation 2",
      "validators",
      "afterValidation (0 errors)",
    ]);
    expect(user.email).toBe("a@example.com");
  });
});
