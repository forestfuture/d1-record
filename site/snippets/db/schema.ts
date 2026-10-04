// As `d1-record schema` generates it, for the guide's examples.

/** billing_accounts */
export const billingAccounts = {
  id: { type: "integer", null: false },
  name: { type: "string", null: false },
  updatedBy: "string",
} as const;

/** Every table, by name, with its attributes and primary key. */
export const tables = {
  billing_accounts: { attributes: billingAccounts, primaryKey: "id" },
} as const;
