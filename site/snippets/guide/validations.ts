import { connect, Model } from "@forestfuture/d1-record";

// #region validates
export class Account extends Model({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  handle: { type: "string", null: false },
  plan: "string",
  seats: "integer",
  website: "string",
  isCompany: "boolean",
  companyName: "string",
}) {
  static tableName = "accounts";

  static {
    this.validates("email", { presence: true, uniqueness: { caseSensitive: false } });
    this.validates("handle", { length: { minimum: 3, maximum: 30 }, format: /^[a-z0-9_]+$/ });
    this.validates("plan", { inclusion: ["free", "team", "enterprise"] });
    this.validates("seats", { numericality: { onlyInteger: true, greaterThan: 0 } });
    this.validates("website", { format: /^https:\/\//, allowNull: true });
    this.validates("companyName", {
      presence: true,
      if: (account) => account.isCompany === true,
      message: "is required for a company",
    });
  }
}
// #endregion validates

// #region custom
export class Booking extends Model({
  id: { type: "integer", null: false },
  startsAt: { type: "datetime", null: false },
  endsAt: { type: "datetime", null: false },
}) {
  static tableName = "bookings";

  static {
    this.afterValidation((booking) => {
      if (booking.endsAt <= booking.startsAt) {
        booking.errors.add("endsAt", "must be after the start", { type: "afterStart" });
      }
    });
  }
}
// #endregion custom

export async function examples(env: Env): Promise<unknown> {
  const db = connect(env.DB);
  // #region errors
  const account = db.model(Account).build({ email: "", handle: "a!" });
  await account.isValid(); // false

  account.errors.get("email"); // ["can't be blank"]
  account.errors.fullMessages(); // ["Email can't be blank", "Handle is too short (minimum is 3 characters)", …]
  account.errors.toArray(); // [{ attribute: "email", type: "blank", message: "can't be blank" }, …]
  console.log(account.errors.size); // 5
  // #endregion errors
  return account;
}
