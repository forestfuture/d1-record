import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import { connect, Model } from "../../src/index.ts";

class User extends Model({
  id: { type: "integer", null: false },
  role: "string",
  isActive: "boolean",
}) {
  static tableName = "users";

  static scopes = this.defineScopes({
    active: (q) => q.where({ isActive: true }),
    admins: (q) => q.where({ role: "admin" }),
  });
}

// No D1 needed: calling scopes only builds Relations.
const db = connect({} as never);

describe("scope inheritance", () => {
  test("a subclass without its own scopes has all of its parent's", () => {
    class Member extends User {}

    const members = db.model(Member);

    expect(typeof members.active().admins).toBe("function");
    expectTypeOf(members.active).toBeFunction();
  });

  test("a subclass adds scopes and can replace one; the parent never gains them", () => {
    class Staff extends User {
      static override scopes = this.defineScopes({
        ...User.scopes,
        admins: (q) => q.where({ role: "staff-admin" }),
        inactive: (q) => q.where({ isActive: false }),
      });
    }

    const staff = db.model(Staff).active().admins().inactive();
    const users = db.model(User);

    expect(staff).toBeDefined();
    expect("inactive" in users).toBe(false);
    expect(Object.keys(Staff.scopes).sort()).toEqual(["active", "admins", "inactive"]);
    expect(Staff.scopes.admins).not.toBe(User.scopes.admins);
  });
});
