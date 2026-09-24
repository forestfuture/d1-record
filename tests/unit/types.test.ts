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
    };
    expectTypeOf(typeOnly).toBeFunction();
  });
});
