import { describe, expect, test } from "vite-plus/test";
import { connect, Model, modelFor, type ErrorMessages } from "../../src/index.ts";

// No D1 needed: none of these validations asks it anything.
const db = connect({} as never);

const tables = {
  accounts: {
    attributes: { id: "integer", email: "string", handle: "string", createdAt: "datetime" },
    primaryKey: "id",
  },
  posts: { attributes: { id: "integer", title: "string" }, primaryKey: "id" },
} as const;

class Base extends Model.Base {
  static override errorMessages: ErrorMessages = {
    blank: "is required",
    tooShort: { one: "needs at least 1 character", other: "needs at least %{count} characters" },
  };
}
const ApplicationRecord = modelFor(tables, Base);

class Account extends ApplicationRecord("accounts") {
  static {
    this.validates("email", { presence: true });
    this.validates("handle", { length: { minimum: 3 } });
  }
}

class Post extends ApplicationRecord("posts") {
  static {
    this.validates("title", { presence: true, length: { minimum: 1 } });
  }
}

class Member extends ApplicationRecord("accounts") {
  static override errorMessages: ErrorMessages = {
    blank: "must be filled in",
    attributes: { email: { blank: "is needed to sign in" } },
  };

  static {
    this.validates("email", { presence: true });
    this.validates("handle", { presence: true, length: { minimum: 3 } });
  }
}

class Admin extends Member {
  static override errorMessages: ErrorMessages = {
    attributes: { handle: { tooShort: "is too short for an admin" } },
  };
}

class Guest extends Member {}

/** The full messages of a record of `model` built from `attributes`, once validated. */
async function messagesOf(model: typeof Account | typeof Post | typeof Member, attributes: object) {
  const record = db.model(model as typeof Account).build(attributes as never);
  await record.isValid();
  return record.errors.fullMessages();
}

// Changing the copy of error messages (#88).
describe("error messages", () => {
  test("the app's base class replaces a built-in message for every Model", async () => {
    expect(await messagesOf(Account, { email: "", handle: "ab" })).toEqual([
      "Email is required",
      "Handle needs at least 3 characters",
    ]);
    expect(await messagesOf(Post, { title: "" })).toEqual([
      "Title is required",
      "Title needs at least 1 character",
    ]);
  });

  test("a Model's own messages win, an attribute's first, then those of each class it extends", async () => {
    const blankAndShort = { email: "", handle: "" };

    expect(await messagesOf(Member, blankAndShort)).toEqual([
      "Email is needed to sign in",
      "Handle must be filled in",
      "Handle needs at least 3 characters",
    ]);
    expect(await messagesOf(Admin, blankAndShort)).toEqual([
      "Email is needed to sign in",
      "Handle must be filled in",
      "Handle is too short for an admin",
    ]);
    expect(await messagesOf(Guest, blankAndShort)).toEqual(await messagesOf(Member, blankAndShort));
  });

  test("a class's own type wins over an attribute's message from a class it extends", async () => {
    class Strict extends Base {
      static override errorMessages: ErrorMessages = { attributes: { title: { blank: "x" } } };
    }
    class Note extends modelFor(tables, Strict)("posts") {
      static override errorMessages: ErrorMessages = { blank: "is empty" };
      static {
        this.validates("title", { presence: true });
      }
    }

    expect(await messagesOf(Note as never, { title: "" })).toEqual(["Title is empty"]);
  });
});
