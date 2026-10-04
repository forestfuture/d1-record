import { column, Model, modelFor, sql } from "@forestfuture/d1-record";
import { tables } from "../db/schema";

// #region declare
export class User extends Model({
  id: { type: "string", null: false, default: () => crypto.randomUUID() },
  email: { type: "string", null: false },
  role: "string",
  isActive: "boolean", // column: is_active
  htmlURL: "string", // column: html_url (a run of capitals is one word)
  legacyId: { type: "integer", column: "person_identifier" },
  settings: { type: "json", default: () => ({ theme: "light" }) },
  createdAt: "datetime",
  updatedAt: "datetime",
}) {
  static primaryKey = "id"; // the default

  static active = this.scope((q) => q.where({ isActive: true }));
  static createdAfter = this.scope((q, since: Date) =>
    q.where(sql`${column("createdAt")} > ${since}`),
  );
}
// #endregion declare

// #region shared
// src/models/application-record.ts: what's written on Base, every Model has.
class Base extends Model.Base {
  label() {
    return `${this.constructor.name} ${JSON.stringify(this.attributes())}`;
  }

  static {
    this.beforeSave((record) => {
      console.log(`Saving ${record.constructor.name}`); // before each Model's own callbacks
    });
  }
}

export const ApplicationRecord = modelFor(tables, Base);

// Every Model built on it has label(), and Base's beforeSave.
export class Account extends ApplicationRecord("billing_accounts") {}
// #endregion shared

// #region generated
// src/models/product.ts (ApplicationRecord comes from ./application-record)
export class Product extends ApplicationRecord("products", {
  available: "boolean", // the column is a plain INTEGER: read it as a boolean
  internalNotes: false, // ignored: never read or written
  priceCents: { default: () => 100 }, // replaces the column's default, 0
}) {
  static inStock = this.scope((q) => q.where({ available: true }));
}
// #endregion generated

export async function examples(): Promise<unknown> {
  // #region build
  const user = User.build({ email: "ada@example.com" });
  console.log(user.id); // already generated, before saving: "3b241101-e2bb-…"
  console.log(user.role); // null: not assigned yet
  console.log(user.settings); // { theme: "light" }

  user.assign({ role: "admin", isActive: true });
  user.isChanged(); // true
  user.changes(); // { email: [null, "ada@example.com"], role: [null, "admin"], … }
  await user.save();
  // #endregion build

  // #region dirty
  user.email = "ada@lovelace.dev";
  user.changed(); // ["email"]
  user.attributeWas("email"); // "ada@example.com"
  user.isAttributeChanged("email", { from: "ada@example.com" }); // true
  await user.save();
  user.savedChangeTo("email"); // ["ada@example.com", "ada@lovelace.dev"]
  user.hasSavedChangeTo("email"); // true
  // #endregion dirty

  // #region scopes
  const admins = await User.active().where({ role: "admin" }).toArray();
  const recent = await User.createdAfter(new Date(Date.now() - 86_400_000)).count();
  // #endregion scopes

  // #region json
  const body = JSON.stringify(user); // dates as ISO strings, associations left out
  const attributes = user.attributes(); // a plain object, dates as Date
  // #endregion json
  return { admins, recent, body, attributes };
}
