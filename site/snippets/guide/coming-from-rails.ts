import { ApplicationRecord } from "./application-record";

// #region declare
// Rails:
//   class Product < ApplicationRecord
//     scope :in_stock, -> { where(available: true) }
//     validates :name, presence: true
//   end
export class Product extends ApplicationRecord {
  static override attributes = { available: "boolean" } as const;
  static inStock = this.scope((q) => q.where({ available: true }));

  static {
    this.validates("name", { presence: true });
  }
}
// #endregion declare
