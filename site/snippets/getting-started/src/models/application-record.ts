import { Model, modelFor } from "@forestfuture/d1-record";
import { tables } from "../db/schema";

/**
 * Methods, callbacks and scopes written here are shared by every Model, as in Rails'
 * ApplicationRecord. It's abstract: it has no table of its own.
 */
class Base extends Model.Base {
  // The D1 binding Models query (Product.find(id)), from your Wrangler config's d1_databases.
  static override binding = "DB";

  // A method every record has:
  // label() {
  //   return `${this.constructor.name} ${JSON.stringify(this.attributes())}`;
  // }

  // A scope every Model has, in SQL since it runs on each Model's own table (import sql too):
  // static newest = this.scope((q) => q.order(sql`created_at DESC`));

  // Log every query, from every Model, in production too (import type QueryListener too; the
  // guide's Connecting page shows development-only logging, and one request's queries):
  // static override onQuery: QueryListener = ({ model, sql, durationMs }) =>
  //   console.log(`${model} ${durationMs.toFixed(1)}ms ${sql}`);

  // Values of attributes named like these show as "[FILTERED]" to onQuery and in errors. These
  // are Rails' defaults (passwords, tokens, keys, emails…); add yours, or leave one out:
  // static override filterAttributes = [...Model.Base.filterAttributes, "iban"];

  // Attributes toJSON() leaves out, so Response.json(record) never sends them (exact names;
  // attributes() still has them):
  // static override hiddenAttributes = ["passwordDigest"];

  // How new TEXT keys are made (a UUID by default), e.g. time-ordered ones from a
  // library you choose:
  // static override generateId = () => uuidv7();

  static {
    // A callback that runs for every Model, before each Model's own:
    // this.beforeSave((record) => {
    //   console.log(`Saving ${record.constructor.name}`);
    // });
  }
}

/** The base class for this app's Models: `class Product extends ApplicationRecord("products") {}`. */
export const ApplicationRecord = modelFor(tables, Base);
