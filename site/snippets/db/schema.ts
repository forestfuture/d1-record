// As `d1-record schema` generates it, for the guide's examples.

/** billing_accounts */
export const billingAccounts = {
  id: { type: "integer", null: false },
  name: { type: "string", null: false },
  updatedBy: "string",
} as const;

/** products */
export const products = {
  id: { type: "string", null: false, generateId: true },
  name: { type: "string", null: false },
  priceCents: { type: "integer", null: false, default: () => 0 },
  available: { type: "integer", null: false, default: () => 1 },
  internalNotes: "string",
  createdAt: { type: "datetime", null: false },
  updatedAt: { type: "datetime", null: false },
} as const;

/** Every table, by name, with its attributes and primary key. */
export const tables = {
  billing_accounts: { attributes: billingAccounts, primaryKey: "id" },
  products: { attributes: products, primaryKey: "id" },
} as const;
