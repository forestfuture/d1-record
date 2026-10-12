import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { connect, Model } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

// Columns as other tools leave them: text from a SQLite default, and integer epochs.
class Event extends Model({
  id: { type: "integer", null: false },
  name: "string",
  happenedAt: { type: "datetime", column: "happened_at" },
}) {
  static tableName = "events";
}

describe("datetimes stored by other tools (#73)", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  const zone = process.env.TZ;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
    await binding
      .prepare(
        "CREATE TABLE events (id INTEGER PRIMARY KEY, name TEXT, happened_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
      )
      .run();
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.prepare("DELETE FROM events").run();
  });
  afterEach(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });

  test("SQLite's own date text (DEFAULT CURRENT_TIMESTAMP) reads as UTC, in any time zone", async () => {
    process.env.TZ = "America/Los_Angeles";
    await binding.prepare("INSERT INTO events (id, name) VALUES (1, 'defaulted')").run();
    await binding
      .prepare("UPDATE events SET happened_at = '2026-10-12 06:38:30.250' WHERE id = 1")
      .run();

    const [event] = await connect(binding).model(Event).toArray();

    expect(event?.happenedAt?.toISOString()).toBe("2026-10-12T06:38:30.250Z");
  });
});
