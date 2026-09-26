import { describe, expect, test } from "vite-plus/test";
import { connect, Model } from "../../src/index.ts";

class Account extends Model({
  id: { type: "integer", null: false },
  handle: "string",
  code: "string",
  plan: "string",
  age: "integer",
  score: "real",
  nickname: "string",
  isStaff: "boolean",
}) {
  static tableName = "accounts";

  static {
    this.validates("handle", { length: { minimum: 3, maximum: 8 } });
    this.validates("code", { length: { is: 4 }, format: /^[A-Z]+$/ });
    this.validates("plan", { inclusion: ["free", "pro"] });
    this.validates("age", {
      numericality: { onlyInteger: true, greaterThanOrEqualTo: 13, lessThan: 130 },
    });
    this.validates("score", { numericality: { greaterThan: 0, lessThanOrEqualTo: 1 } });
    this.validates("nickname", {
      format: { with: /^\w+$/ },
      allowNull: true,
      message: "only letters",
    });
    this.validates("isStaff", { presence: true, if: (account) => account.plan === "pro" });
  }
}

const accounts = connect({} as never).model(Account);

const valid = {
  handle: "chris",
  code: "ABCD",
  plan: "free",
  age: 30,
  score: 0.5,
  nickname: null,
  isStaff: null,
};

/** Validates a record that differs from `valid` by `changes` (which may hold deliberately wrong types). */
async function errorsFor(changes: Record<string, unknown>) {
  const account = accounts.build({ ...valid, ...changes } as never);
  await account.isValid();
  return account.errors
    .toArray()
    .map(({ attribute, type, message }) => `${attribute} ${type}: ${message}`);
}

describe("validators", () => {
  test("a record meeting every rule is valid", async () => {
    expect(await errorsFor({})).toEqual([]);
  });

  test("length checks minimum, maximum and exact length", async () => {
    expect(await errorsFor({ handle: "ab" })).toEqual([
      "handle tooShort: is too short (minimum is 3 characters)",
    ]);
    expect(await errorsFor({ handle: "abcdefghi" })).toEqual([
      "handle tooLong: is too long (maximum is 8 characters)",
    ]);
    expect(await errorsFor({ code: "ABC" })).toEqual([
      "code wrongLength: is the wrong length (should be 4 characters)",
    ]);
  });

  test("every validator runs, so one attribute can collect several errors", async () => {
    expect(await errorsFor({ code: "abc" })).toEqual([
      "code wrongLength: is the wrong length (should be 4 characters)",
      "code invalid: is invalid",
    ]);
  });

  test("inclusion and numericality", async () => {
    expect(await errorsFor({ plan: "gold" })).toEqual([
      "plan inclusion: is not included in the list",
    ]);
    expect(await errorsFor({ age: 12 })).toEqual([
      "age greaterThanOrEqualTo: must be greater than or equal to 13",
    ]);
    expect(await errorsFor({ age: 30.5 })).toEqual(["age notAnInteger: must be an integer"]);
    expect(await errorsFor({ age: "30" })).toEqual(["age notANumber: is not a number"]);
    expect(await errorsFor({ score: 0 })).toEqual(["score greaterThan: must be greater than 0"]);
    expect(await errorsFor({ score: 1.5 })).toEqual([
      "score lessThanOrEqualTo: must be less than or equal to 1",
    ]);
  });

  test("allowNull skips a null value, message replaces the default, and if decides whether to run", async () => {
    expect(await errorsFor({ nickname: "no spaces!" })).toEqual(["nickname invalid: only letters"]);
    expect(await errorsFor({ plan: "pro" })).toEqual(["isStaff blank: can't be blank"]);
    expect(await errorsFor({ plan: "pro", isStaff: false })).toEqual([]);
  });

  test("validators other than presence treat null as failing unless allowNull is set", async () => {
    expect(await errorsFor({ plan: null })).toEqual([
      "plan inclusion: is not included in the list",
    ]);
    expect(await errorsFor({ age: null })).toEqual(["age notANumber: is not a number"]);
  });

  test("format gives the same answer every time, even with a /g or /y pattern", async () => {
    class Tag extends Model({ id: "integer", name: "string" }) {
      static tableName = "tags";
      static {
        this.validates("name", { format: /^[a-z]+$/g });
      }
    }
    const tag = connect({} as never)
      .model(Tag)
      .build({ name: "news" });

    const results = [await tag.isValid(), await tag.isValid(), await tag.isValid()];

    expect(results).toEqual([true, true, true]);
  });
});
