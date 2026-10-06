import { ApplicationRecord } from "./application-record";

// #region overrides
export class Product extends ApplicationRecord("products", {
  available: "boolean", // the column is a plain INTEGER: read it as a boolean
  internalNotes: false, // ignored: never read or written
  priceCents: { default: () => 100 }, // replaces the column's default, 0
}) {
  static inStock = this.scope((q) => q.where({ available: true }));
}
// #endregion overrides
