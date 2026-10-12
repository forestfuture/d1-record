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

// Drizzle's integer({ mode: "timestamp" }) and integer({ mode: "timestamp_ms" }).
class Stamp extends Model({
  id: { type: "integer", null: false },
  name: "string",
  seconds: { type: "datetime", storage: "unixSeconds" },
  milliseconds: { type: "datetime", storage: "unixMilliseconds" },
}) {
  static tableName = "stamps";
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
    await binding
      .prepare(
        "CREATE TABLE stamps (id INTEGER PRIMARY KEY, name TEXT, seconds INTEGER, milliseconds INTEGER)",
      )
      .run();
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.batch([
      binding.prepare("DELETE FROM events"),
      binding.prepare("DELETE FROM stamps"),
    ]);
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

  test("an integer column declared with a storage reads as a Date", async () => {
    await binding.prepare("INSERT INTO stamps VALUES (1, 'a', 1767323045, 1767323045678)").run();

    const [stamp] = await connect(binding).model(Stamp).toArray();

    expect(stamp?.seconds?.toISOString()).toBe("2026-01-02T03:04:05.000Z");
    expect(stamp?.milliseconds?.toISOString()).toBe("2026-01-02T03:04:05.678Z");
  });
});
