import { Model } from "@forestfuture/d1-record";

// #region declare
export class User extends Model({ id: "integer", email: { type: "string", null: false } }) {
  static {
    this.validates("email", { presence: true, uniqueness: true });
  }
}
// #endregion declare
