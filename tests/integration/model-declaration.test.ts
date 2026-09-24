import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { connect, D1RecordError, InvalidModel, Model, UnknownAttribute } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

describe("model declaration", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());

  test("a model without a tableName is rejected when first used", () => {
    class Nameless extends Model({ id: "integer" }) {}

    const use = () => connect(binding).model(Nameless);

    expect(use).toThrow(InvalidModel);
    expect(use).toThrow(/Nameless.*tableName/);
    expect(use).toThrow(D1RecordError);
  });

  test("a class field that would hide an attribute's accessor is rejected when first used", () => {
    class Shadowed extends Model({ email: "string" }) {
      static tableName = "users";
      email!: string | null; // should have been left to Model({...})
    }

    expect(() => connect(binding).model(Shadowed)).toThrow(/Shadowed.*"email"/);
  });

  test("where rejects a key that isn't a declared attribute", () => {
    class User extends Model({ email: "string" }) {
      static tableName = "users";
    }
    const users = connect(binding).model(User);

    // @ts-expect-error `emial` isn't an attribute of User
    expect(() => users.where({ emial: "a@example.com" })).toThrow(UnknownAttribute);
    // @ts-expect-error columns aren't attributes: the attribute would be `createdAt`
    expect(() => users.where({ created_at: null })).toThrow(/User.*"created_at"/);
  });

  test("an attribute named like a record method is rejected when first used", () => {
    class Clashing extends Model({ attributes: "json" }) {
      static tableName = "users";
    }

    expect(() => connect(binding).model(Clashing)).toThrow(/Clashing.*"attributes"/);
  });
});
