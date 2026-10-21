import { describe, expect, test } from "vite-plus/test";
import {
  connect,
  hasMany,
  InvalidModel,
  Model,
  modelFor,
  type ErrorMessages,
} from "../../src/index.ts";

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
  static {
    this.humanAttributeNames({ createdAt: "Signed up", email: "Email" });
    this.errorMessages({
      blank: "is required",
      tooShort: { one: "needs at least 1 character", other: "needs at least %{count} characters" },
    });
  }
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
  static {
    this.errorMessages({
      blank: "must be filled in",
      attributes: { email: { blank: "is needed to sign in" } },
    });
    this.validates("email", { presence: true });
    this.validates("handle", { presence: true, length: { minimum: 3 } });
  }
}

class Admin extends Member {
  static {
    this.errorMessages({ attributes: { handle: { tooShort: "is too short for an admin" } } });
  }
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
      static {
        this.errorMessages({ attributes: { title: { blank: "x" } } });
      }
    }
    class Note extends modelFor(tables, Strict)("posts") {
      static {
        this.errorMessages({ blank: "is empty" });
        this.validates("title", { presence: true });
      }
    }

    expect(await messagesOf(Note as never, { title: "" })).toEqual(["Title is empty"]);
  });

  test("an attribute's name in full messages and %{attribute} comes from humanAttributeNames", async () => {
    class Signup extends ApplicationRecord("accounts") {
      static {
        this.humanAttributeNames({ email: "Email address" });
        this.errorMessages({
          attributes: { createdAt: { blank: "is missing: %{attribute} is set on save" } },
        });
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
      static {
        this.errorMessages({ afterStart: "must be after the start" });
      }
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

  test("toArray() gives an error's values, when it has some, but never the attribute's value", async () => {
    const account = db.model(Account).build({ email: "", handle: "ab" });
    await account.isValid();
    account.errors.add("base", { type: "blank", reason: "locked" });

    expect(account.errors.toArray()).toStrictEqual([
      { attribute: "email", type: "blank", message: "is required" },
      {
        attribute: "handle",
        type: "tooShort",
        message: "needs at least 3 characters",
        values: { count: 3 },
      },
      { attribute: "base", type: "blank", message: "is required", values: { reason: "locked" } },
    ]);
  });

  test("a Model's messages or names for an attribute it doesn't have are refused at first use", () => {
    class Typo extends ApplicationRecord("accounts") {
      static {
        // @ts-expect-error a Model's messages name its attributes, associations or base
        this.errorMessages({ attributes: { emial: { blank: "x" } } });
      }
    }
    class Renamed extends ApplicationRecord("accounts") {
      static {
        // @ts-expect-error the same for its attribute names
        this.humanAttributeNames({ emial: "Email address" });
      }
    }
    class Owner extends ApplicationRecord("accounts") {
      posts = hasMany(Post, { foreignKey: "id" });
      static {
        this.errorMessages({
          attributes: { base: { blank: "x" }, posts: { invalid: "have a problem" } },
        });
        this.humanAttributeNames({ posts: "Articles" });
      }
    }

    expect(() => db.model(Typo)).toThrow(InvalidModel);
    expect(() => db.model(Typo)).toThrow(
      /Typo's errorMessages has messages for "emial", which isn't one of its attributes/,
    );
    expect(() => db.model(Renamed)).toThrow(/Renamed's humanAttributeNames names "emial"/);
    // The app's base class names createdAt and email, which Post doesn't have.
    expect(() => db.model(Post)).not.toThrow();
    expect(() => db.model(Owner)).not.toThrow();
  });

  test("%{value} is the attribute's value, [FILTERED] when it's filtered, and %{model} the Model", async () => {
    class BlogAccount extends ApplicationRecord("accounts") {
      static {
        this.errorMessages({ invalid: "%{value} isn't allowed for a %{model}" });
        this.validates("handle", { format: /^[a-z]+$/ });
        this.validates("email", { format: /@/ });
      }
    }

    expect(await messagesOf(BlogAccount as never, { handle: "Ada!", email: "ada" })).toEqual([
      "Handle Ada! isn't allowed for a Blog account",
      "Email [FILTERED] isn't allowed for a Blog account",
    ]);
  });

  test("a class's calls add up, a later one's message winning, and none is allowed after first use", async () => {
    const shared: ErrorMessages = { blank: "is required here" };
    class Twice extends ApplicationRecord("posts") {
      static {
        this.errorMessages(shared);
        this.errorMessages({ tooShort: "is too short" });
        this.errorMessages({ blank: "is required, twice" });
        this.validates("title", { presence: true, length: { minimum: 1 } });
      }
    }

    expect(await messagesOf(Twice as never, { title: "" })).toEqual([
      "Title is required, twice",
      "Title is too short",
    ]);
    expect(() => Twice.errorMessages({ blank: "later" })).toThrow(InvalidModel);
  });
});
