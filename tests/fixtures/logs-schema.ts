// The generated schema for logs.sql and the Models on LogsRecord, in the shape `d1-record
// schema` writes (#232).
import type { TableAttributes } from "@forestfuture/d1-record";

/** events */
export const events = {
  id: { type: "integer", null: false },
  name: { type: "string", null: false },
} as const;

/** This database's binding, tables, and the Models the schema was generated for. */
export const schema = {
  binding: "LOGS",
  tables: {
    events: { attributes: events, primaryKey: "id" },
  },
  models: { Event: "events" },
} as const;

declare module "./models/event.ts" {
  interface Event extends TableAttributes<typeof events, (typeof Event)["attributes"]> {}
}
