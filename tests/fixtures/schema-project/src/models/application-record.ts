import { Model, modelFor, sql, type QueryListener } from "@forestfuture/d1-record";
import { tables } from "../../schema";

/**
 * Methods, callbacks and scopes written here are shared by every Model, as in Rails'
 * ApplicationRecord. It's abstract: it has no table of its own.
 */
class Base extends Model {
  // The D1 binding Models query (Product.find(id)), from your Wrangler config's d1_databases.
  static override binding = "DB";

  // A method every record has:
  label() {
    return `${this.constructor.name} ${JSON.stringify(this.attributes())}`;
  }

  // A scope every Model has, in SQL since it runs on each Model's own table:
  static newest = this.scope((q) => q.order(sql`created_at DESC`));

  // Log every query, from every Model (for one request's queries, with its ID, see withDatabase
  // in the guide's Connecting page):
  static override onQuery: QueryListener = ({ model, sql, durationMs }) =>
    console.log(`${model} ${durationMs.toFixed(1)}ms ${sql}`);

  static {
    // A callback that runs for every Model, before each Model's own:
    this.beforeSave((record) => {
      console.log(`Saving ${record.constructor.name}`);
    });
  }
}

/** The base class for this app's Models: `class Product extends ApplicationRecord("products") {}`. */
export const ApplicationRecord = modelFor(tables, Base);
