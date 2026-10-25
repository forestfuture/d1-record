import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { connect, InvalidModel, Model, modelFor } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
}) {
  static table = "users";
  static hiddenAttributes = ["email"];
}

class Member extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
}) {
  static table = "users";
}

class Base extends Model {
  static override hiddenAttributes = ["email"];
}
const ApplicationRecord = modelFor(
  {
    users: {
      attributes: { id: "integer", email: "string", role: "string" },
      primaryKey: "id",
    },
  } as const,
  Base,
);

// What `toJSON()` leaves out of a record, so `Response.json(user)` can't leak it (#101).
describe("hiddenAttributes", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.prepare("DELETE FROM users").run();
  });

  test("a Model's toJSON leaves them out, and attributes() keeps them", async () => {
    const user = await connect(binding)
      .model(User)
      .create({ id: 1, email: "ada@example.com", role: "admin" });

    expect(user.toJSON()).toEqual({ id: 1, role: "admin" });
    expect(JSON.parse(JSON.stringify(user))).toEqual({ id: 1, role: "admin" });
    expect(user.attributes()).toEqual({ id: 1, email: "ada@example.com", role: "admin" });
  });

  test("none are hidden by default", async () => {
    const member = await connect(binding)
      .model(Member)
      .create({ id: 1, email: "ada@example.com", role: "admin" });

    expect(member.toJSON()).toEqual({ id: 1, email: "ada@example.com", role: "admin" });
  });

  test("a hidden attribute a partial record didn't load is no problem", async () => {
    await connect(binding).model(User).create({ id: 1, email: "ada@example.com", role: "admin" });
    const [user] = await connect(binding).model(User).select("id", "role").toArray();

    expect(user?.toJSON()).toEqual({ id: 1, role: "admin" });
  });

  describe("on an app's base class", () => {
    const row = { id: 1, email: "ada@example.com", role: "admin" };

    test("every Model built on it inherits them", async () => {
      class Account extends ApplicationRecord("users") {}
      const account = await connect(binding).model(Account).create(row);

      expect(account.toJSON()).toEqual({ id: 1, role: "admin" });
    });

    test("a Model's own list replaces them", async () => {
      class Account extends ApplicationRecord("users") {
        static override hiddenAttributes = [...Base.hiddenAttributes, "role"];
      }
      const account = await connect(binding).model(Account).create(row);

      expect(account.toJSON()).toEqual({ id: 1 });
    });

    test("an empty list of its own hides nothing", async () => {
      class Reader extends ApplicationRecord("users") {
        static override hiddenAttributes = [];
      }
      const reader = await connect(binding).model(Reader).create(row);

      expect(reader.toJSON()).toEqual(row);
    });
  });

  describe("naming one the Model doesn't have", () => {
    test("in its own list is an InvalidModel", () => {
      class Typo extends Model.define({ id: "integer", role: "string" }) {
        static override table = "users";
        static override hiddenAttributes = ["rol"];
      }

      expect(() => connect(binding).model(Typo)).toThrow(
        new InvalidModel(
          'Typo hides "rol" from toJSON, but has no such attribute; hiddenAttributes names attributes exactly',
        ),
      );
    });

    test("is ignored when the base class's list does", () => {
      const Slim = modelFor(
        { users: { attributes: { id: "integer", role: "string" }, primaryKey: "id" } } as const,
        Base,
      );
      class Plain extends Slim("users") {}
      class Extended extends Slim("users") {
        static override hiddenAttributes = [...Base.hiddenAttributes, "role"];
      }
      const db = connect(binding);

      expect(() => db.model(Plain)).not.toThrow();
      expect(() => db.model(Extended)).not.toThrow();
    });

    test("is ignored when Model's list does", () => {
      const before = Model.hiddenAttributes;
      Model.hiddenAttributes = ["nickname"];
      try {
        class Plain extends Model.define({ id: "integer", role: "string" }) {
          static override table = "users";
        }

        expect(() => connect(binding).model(Plain)).not.toThrow();
      } finally {
        Model.hiddenAttributes = before;
      }
    });

    test("in its own list is still an InvalidModel when the base class has a list", () => {
      class Typo extends ApplicationRecord("users") {
        static override hiddenAttributes = [...Base.hiddenAttributes, "rol"];
      }

      expect(() => connect(binding).model(Typo)).toThrow(InvalidModel);
    });

    test("is fine for a Model that extends another Model, which has the parent's attributes", () => {
      class Account extends ApplicationRecord("users") {}
      class Admin extends Account {
        static override hiddenAttributes = ["role"];
      }

      expect(() => connect(binding).model(Admin)).not.toThrow();
    });
  });

  test("the list is read each time, so a change after first use applies", async () => {
    class Live extends Model.define({ id: "integer", email: "string", role: "string" }) {
      static override table = "users";
    }
    const live = await connect(binding)
      .model(Live)
      .create({ id: 1, email: "ada@example.com", role: "admin" });
    Live.hiddenAttributes = ["role"];

    expect(live.toJSON()).toEqual({ id: 1, email: "ada@example.com" });
  });
});
