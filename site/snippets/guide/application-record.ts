import { Model, modelFor } from "@forestfuture/d1-record";
import { tables } from "../db/schema";

// #region shared
// What's written on Base, every Model has.
class Base extends Model {
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
