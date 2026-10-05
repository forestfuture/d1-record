import { Model } from "@forestfuture/d1-record";

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
  static {
    this.afterValidation((booking) => {
      if (booking.endsAt <= booking.startsAt) {
        booking.errors.add("endsAt", "must be after the start", { type: "afterStart" });
      }
    });
  }
}
// #endregion custom

export async function addExample() {
  const booking = Booking.build({
    startsAt: new Date("2026-05-01T10:00:00Z"),
    endsAt: new Date("2026-05-01T12:00:00Z"),
  });
  // #region add
  booking.errors.add("endsAt", "must be after the start", { type: "afterStart" });
  booking.errors.add("base", "The room is closed that day");

  const entries = booking.errors.toArray();
  // [{ attribute: "endsAt", type: "afterStart", message: "must be after the start" },
  //  { attribute: "base", type: "invalid", message: "The room is closed that day" }]
  const messages = booking.errors.fullMessages(); // ["Ends at must be after the start", "The room is closed that day"]

  const valid = await booking.isValid(); // true: each validation run starts by clearing errors
  // #endregion add
  return { booking, entries, messages, valid };
}

export async function errorsExample() {
  // #region errors
  const account = Account.build({ email: "", handle: "a!" });
  await account.isValid(); // false

  account.errors.get("email"); // ["can't be blank"]
  account.errors.fullMessages(); // ["Email can't be blank", "Handle is too short (minimum is 3 characters)", …]
  account.errors.toArray(); // [{ attribute: "email", type: "blank", message: "can't be blank" }, …]
  console.log(account.errors.size); // 5
  // #endregion errors
  return account;
}
