import { column, gte, Model, modelFor, sql } from "@forestfuture/d1-record";

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
    // Columns from integer({ mode: "timestamp" }) and integer({ mode: "timestamp_ms" }).
    articles: {
      attributes: {
        id: { type: "string", null: false, generateId: true },
        publishedAt: "integer",
        updatedAt: "integer",
      },
      primaryKey: "id",
    },
  } as const,
  Model,
);

// #region overrides
export class Post extends ApplicationRecord("posts", {
  metadata: "json", // text({ mode: "json" }): JSON in a plain TEXT column
  archived: "boolean", // integer({ mode: "boolean" }): 0 or 1
  legacyNotes: false, // a column this app no longer uses: never read or written
}) {}
// #endregion overrides

// #region timestamps
export class Article extends ApplicationRecord("articles", {
  publishedAt: { type: "datetime", storage: "unixSeconds" }, // timestamp: seconds
  updatedAt: { type: "datetime", storage: "unixMilliseconds" }, // timestamp_ms: milliseconds
}) {}

export function publishedSince(since: Date) {
  return Article.where({ publishedAt: gte(since) });
}
// #endregion timestamps

// #region fragment
export function publishedBefore(before: Date) {
  const publishedAt = column("publishedAt");
  return Article.where(sql`${publishedAt} < ${publishedAt.value(before)}`);
}
// #endregion fragment
