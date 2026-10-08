import { Model, modelFor } from "@forestfuture/d1-record";

// A Drizzle app's posts table, as `d1-record schema` reads it: plain TEXT and INTEGER columns.
const ApplicationRecord = modelFor(
  {
    posts: {
      attributes: {
        id: { type: "string", null: false, generateId: true },
        title: { type: "string", null: false },
        metadata: "string",
        archived: "integer",
        legacyNotes: "string",
        publishedAt: "integer",
      },
      primaryKey: "id",
    },
  } as const,
  Model.Base,
);

// #region overrides
export class Post extends ApplicationRecord("posts", {
  metadata: "json", // text({ mode: "json" }): JSON in a plain TEXT column
  archived: "boolean", // integer({ mode: "boolean" }): 0 or 1
  legacyNotes: false, // a column this app no longer uses: never read or written
}) {}
// #endregion overrides
