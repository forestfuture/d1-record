import { Model, modelFor, sql } from "@forestfuture/d1-record";
import { tables } from "../../schema";

/**
 * Methods, callbacks and scopes written here are shared by every Model, as in Rails'
 * ApplicationRecord. It's abstract: it has no table of its own.
 */
class Base extends Model.Base {
  // A method every record has:
  label() {
    return `${this.constructor.name} ${JSON.stringify(this.attributes())}`;
  }

  // A scope every Model has, in SQL since it runs on each Model's own table:
  static newest = this.scope((q) => q.order(sql`created_at DESC`));

  static {
    // A callback that runs for every Model, before each Model's own:
    this.beforeSave((record) => {
      console.log(`Saving ${record.constructor.name}`);
    });
  }
}

/** The base class for this app's Models: `class Product extends ApplicationRecord("products") {}`. */
export const ApplicationRecord = modelFor(tables, Base);
