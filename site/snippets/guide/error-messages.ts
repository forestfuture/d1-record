import { Model, modelFor, type ErrorMessages } from "@forestfuture/d1-record";
import { tables } from "../db/schema";

// #region base
// src/models/application-record.ts
class Base extends Model.Base {
  static override errorMessages: ErrorMessages = {
    blank: "is required",
    tooShort: {
      one: "needs at least 1 character",
      other: "needs at least %{count} characters",
    },
  };

  static override humanAttributeNames: Record<string, string> = {
    createdAt: "Added on",
  };
}

export const ApplicationRecord = modelFor(tables, Base);
// #endregion base

// #region model
export class Product extends ApplicationRecord("products") {
  static override errorMessages: ErrorMessages = {
    greaterThan: "must be more than %{count}",
    attributes: {
      name: { blank: "needs a name customers will see" },
    },
  };

  static override humanAttributeNames = { priceCents: "Price" };

  static {
    this.validates("name", { presence: true, length: { minimum: 3 } });
    this.validates("priceCents", { numericality: { greaterThan: 0 } });
  }
}
// #endregion model

export async function messagesExample() {
  // #region read
  const product = Product.build({ name: "", priceCents: 0 });
  await product.isValid(); // false

  product.errors.fullMessages();
  // ["Name needs a name customers will see",
  //  "Name needs at least 3 characters",
  //  "Price must be more than 0"]
  Product.humanAttributeName("priceCents"); // "Price"
  // #endregion read
  return product;
}
