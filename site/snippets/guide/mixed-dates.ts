import { column, Model, sql } from "@forestfuture/d1-record";

export class Event extends Model({
  id: { type: "integer", null: false },
  name: { type: "string", null: false },
  createdAt: { type: "datetime", null: false },
}) {
  static tableName = "events";
}

// #region recipe
export function createdSince(since: Date) {
  const createdAt = column("createdAt");
  // strftime reads every form SQLite knows and writes d1-record's ISO text, so they compare
  return Event.where(
    sql`strftime('%Y-%m-%dT%H:%M:%fZ', ${createdAt}) >= ${createdAt.value(since)}`,
  );
}
// #endregion recipe
