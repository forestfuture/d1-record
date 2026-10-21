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
  static override humanAttributeNames: Record<string, string> = {
    createdAt: "Signed up",
    email: "Email",
  };
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

  test("an attribute's name in full messages and %{attribute} comes from humanAttributeNames", async () => {
    class Signup extends ApplicationRecord("accounts") {
      static override humanAttributeNames = { email: "Email address" };
      static override errorMessages: ErrorMessages = {
        attributes: { createdAt: { blank: "is missing: %{attribute} is set on save" } },
      };
      static {
        this.validates("email", { presence: true });
        this.validates("createdAt", { presence: true });
      }
    }

    expect(await messagesOf(Signup as never, { email: "" })).toEqual([
      "Email address is required",
      "Signed up is missing: Signed up is set on save",
    ]);
    expect(Signup.humanAttributeName("email")).toBe("Email address");
    expect(Signup.humanAttributeName("createdAt")).toBe("Signed up");
    expect(Signup.humanAttributeName("handle")).toBe("Handle");
    expect(Model.Base.humanAttributeName("updatedAt")).toBe("Updated at");
  });

  test("errors.add with a type alone looks its message up, filling in the values given", () => {
    const member = db.model(Member).build({ handle: "ab" });
    class Booking extends ApplicationRecord("posts") {
      static override errorMessages: ErrorMessages = { afterStart: "must be after the start" };
    }
    const booking = db.model(Booking).build();

    booking.errors.add("title", { type: "afterStart" });
    member.errors.add("handle", { type: "tooShort", count: 5 });
    member.errors.add("base", "Account is locked");

    expect(booking.errors.fullMessages()).toEqual(["Title must be after the start"]);
    expect(member.errors.fullMessages()).toEqual([
      "Handle needs at least 5 characters",
      "Account is locked",
    ]);
  });

  test("a type with no message anywhere is refused when it's added", () => {
    const member = db.model(Member).build();

    expect(() => member.errors.add("handle", { type: "afterStart" })).toThrow(
      /No message for the error "afterStart" on "handle": add one to Member's errorMessages/,
    );
    expect(member.errors.size).toBe(0);
  });

  test("errors.add's options are typed", () => {
    const member = db.model(Member).build();

    // @ts-expect-error a type is required when there's no message
    expect(() => member.errors.add("handle", { count: 3 })).toThrow();
    // @ts-expect-error a value is text or a number
    expect(() => member.errors.add("handle", { type: "blank", at: new Date() })).not.toThrow();
  });
});
