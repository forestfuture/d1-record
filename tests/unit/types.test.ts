import { describe, expectTypeOf, test } from "vite-plus/test";
import { connect, Model, sql, type Relation } from "../../src/index.ts";

class User extends Model({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  isActive: "boolean",
  createdAt: "datetime",
  ratio: "real",
  settings: "json",
}) {
  static tableName = "users";

  get label(): string {
    return this.email.toUpperCase();
  }
}

// connect() never touches the binding until a query runs, and these tests run none.
const db = connect({} as never);

describe("types", () => {
  test("record properties are inferred from Model({...}), nullable unless null: false", () => {
    expectTypeOf<User["id"]>().toEqualTypeOf<number>();
    expectTypeOf<User["email"]>().toEqualTypeOf<string>();
    expectTypeOf<User["isActive"]>().toEqualTypeOf<boolean | null>();
    expectTypeOf<User["createdAt"]>().toEqualTypeOf<Date | null>();
    expectTypeOf<User["ratio"]>().toEqualTypeOf<number | null>();
    expectTypeOf<User["settings"]>().toEqualTypeOf<unknown>();
  });

  test("a relation resolves to records of its model", () => {
    const relation = db.model(User);

    expectTypeOf(relation).toEqualTypeOf<Relation<User>>();
    expectTypeOf<ReturnType<typeof relation.toArray>>().toEqualTypeOf<Promise<User[]>>();
    expectTypeOf(db.models({ User }).User).toEqualTypeOf<Relation<User>>();
  });

  test("where accepts declared attributes with their value types, or an sql fragment", () => {
    const users = db.model(User);

    // Checked by the type checker only; never called.
    const typeOnly = () => {
      users.where({ isActive: true, createdAt: null });
      users.where(sql`email = ${"a@example.com"}`);
      // @ts-expect-error wrong value type for a boolean attribute
      users.where({ isActive: "yes" });
      // @ts-expect-error getters aren't attributes
      users.where({ label: "A" });
      // @ts-expect-error email can't be null
      users.where({ email: null });
      users.where({ id: [1, 2], isActive: [true, null] });
      // @ts-expect-error email can't be null, so null can't be in its array either
      users.where({ email: ["a@example.com", null] });
      // @ts-expect-error array items must have the attribute's type
      users.where({ id: ["1"] });
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("finders and pluck return precise types", () => {
    const users = db.model(User);

    expectTypeOf<ReturnType<typeof users.find>>().toEqualTypeOf<Promise<User>>();
    expectTypeOf<ReturnType<typeof users.findBy>>().toEqualTypeOf<Promise<User | null>>();
    expectTypeOf<ReturnType<typeof users.first>>().toEqualTypeOf<Promise<User | null>>();

    // Checked by the type checker only; never called.
    const typeOnly = async () => {
      expectTypeOf(await users.pluck("email")).toEqualTypeOf<string[]>();
      expectTypeOf(await users.pluck("id", "isActive")).toEqualTypeOf<[number, boolean | null][]>();
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("order, select, pluck and count accept only declared attributes", () => {
    const users = db.model(User);

    // Checked by the type checker only; never called.
    const typeOnly = () => {
      users.order({ createdAt: "desc", id: "asc" }).select("email", "isActive").distinct();
      void users.count("isActive");
      // @ts-expect-error direction must be "asc" or "desc"
      users.order({ id: "up" });
      // @ts-expect-error getters aren't attributes
      users.order({ label: "asc" });
      // @ts-expect-error unknown attribute
      users.select("nope");
      // @ts-expect-error unknown attribute
      void users.pluck("nope");
      // @ts-expect-error unknown attribute
      void users.count("nope");
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("the record lifecycle API is typed against the Model's attributes", () => {
    const users = db.model(User);
    const user = users.build({ email: "a@example.com" });

    expectTypeOf(user).toEqualTypeOf<User>();
    expectTypeOf<ReturnType<typeof users.create>>().toEqualTypeOf<Promise<User>>();
    expectTypeOf<ReturnType<typeof users.createOrThrow>>().toEqualTypeOf<Promise<User>>();
    expectTypeOf<ReturnType<typeof user.save>>().toEqualTypeOf<Promise<boolean>>();
    expectTypeOf<ReturnType<typeof user.destroy>>().toEqualTypeOf<Promise<User | false>>();
    expectTypeOf<ReturnType<typeof user.destroyOrThrow>>().toEqualTypeOf<Promise<User>>();
    expectTypeOf<ReturnType<typeof user.reload>>().toEqualTypeOf<Promise<User>>();

    // Checked by the type checker only; never called.
    const typeOnly = async () => {
      user.assign({ isActive: true, createdAt: null });
      await user.update({ email: "b@example.com" });
      // @ts-expect-error unknown attribute
      users.build({ nope: 1 });
      // @ts-expect-error wrong value type
      user.assign({ isActive: "yes" });
      // @ts-expect-error email can't be null
      await user.update({ email: null });
    };
    expectTypeOf(typeOnly).toBeFunction();
  });
});
