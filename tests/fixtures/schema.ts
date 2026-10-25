// The generated schema for the tables in schema.sql and the Models in models/, in the shape
// `d1-record schema` writes (#232).
import type { TableAttributes } from "@forestfuture/d1-record";

/** users */
export const users = {
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
  isActive: { type: "boolean", null: false, default: () => true },
  suspended: { type: "boolean", null: false, default: () => false },
  age: "integer",
  createdAt: "datetime",
  updatedAt: "datetime",
} as const;

/** posts */
export const posts = {
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
  published: { type: "integer", null: false, default: () => 0 },
  createdAt: "datetime",
  updatedAt: "datetime",
} as const;

/** accounts */
export const accounts = {
  id: { type: "integer", null: false },
  isActive: "boolean",
  externalAccountId: "string",
  htmlUrl: "string",
  userId: "integer",
  sha256Hash: "string",
  personIdentifier: "string",
} as const;

/** This database's binding, tables, and the Models the schema was generated for. */
export const schema = {
  binding: "DB",
  tables: {
    users: { attributes: users, primaryKey: "id" },
    posts: { attributes: posts, primaryKey: "id" },
    accounts: { attributes: accounts, primaryKey: "id" },
  },
  models: { User: "users", Post: "posts", Customer: "accounts" },
} as const;

declare module "./models/user.ts" {
  interface User extends TableAttributes<typeof users, (typeof User)["attributes"]> {}
}

declare module "./models/post.ts" {
  interface Post extends TableAttributes<typeof posts, (typeof Post)["attributes"]> {}
}

declare module "./models/customer.ts" {
  interface Customer extends TableAttributes<typeof accounts, (typeof Customer)["attributes"]> {}
}
