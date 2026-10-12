import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { between, connect, gte, Model } from "../../src/index.ts";
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

// created_at and updated_at as integer milliseconds, as an app that timestamps with Drizzle has.
class Entry extends Model({
  id: { type: "integer", null: false },
  title: "string",
  createdAt: { type: "datetime", storage: "unixMilliseconds" },
  updatedAt: { type: "datetime", storage: "unixMilliseconds" },
}) {
  static tableName = "entries";
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
        "CREATE TABLE entries (id INTEGER PRIMARY KEY, title TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
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
      binding.prepare("DELETE FROM entries"),
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

  // From a form or JSON, so not typed as a Date.
  const untyped = (value: unknown) => value as never;

  // The tests below passed on first run: the storage rides on the converters, so they guard it.
  const raw = async (table: string) =>
    (await binding.prepare(`SELECT * FROM ${table} ORDER BY id`).all()).results;

  test("saving writes the integer, in seconds or milliseconds", async () => {
    const stamps = connect(binding).model(Stamp);

    await stamps.create({
      name: "a",
      seconds: new Date("2026-01-02T03:04:05.678Z"),
      milliseconds: new Date("2026-01-02T03:04:05.678Z"),
    });

    expect(await raw("stamps")).toMatchObject([
      { seconds: 1767323045, milliseconds: 1767323045678 },
    ]);
  });

  test("created_at and updated_at are set as integers", async () => {
    const entries = connect(binding).model(Entry);
    const before = Date.now();

    const entry = await entries.create({ title: "a" });
    const [row] = (await raw("entries")) as { created_at: number; updated_at: number }[];

    expect(row!.created_at).toBeGreaterThanOrEqual(before);
    expect(row!.updated_at).toBe(row!.created_at);
    expect(entry.createdAt?.getTime()).toBe(row!.created_at);

    await entry.update({ title: "b" });
    const [updated] = (await raw("entries")) as { created_at: number; updated_at: number }[];

    expect(updated!.created_at).toBe(row!.created_at);
    expect(updated!.updated_at).toBeGreaterThanOrEqual(row!.updated_at);
  });

  test("conditions on the attribute compare integers, given Dates", async () => {
    await binding.batch([
      binding.prepare("INSERT INTO stamps VALUES (1, 'a', 1767225600, 1767225600000)"),
      binding.prepare("INSERT INTO stamps VALUES (2, 'b', 1767312000, 1767312000000)"),
      binding.prepare("INSERT INTO stamps VALUES (3, 'c', 1767398400, 1767398400000)"),
    ]);
    const stamps = connect(binding).model(Stamp);
    const names = async (relation: ReturnType<typeof stamps.where>) =>
      (await relation.order({ id: "asc" }).toArray()).map((stamp) => stamp.name);

    const second = new Date("2026-01-02T00:00:00.000Z");
    const third = new Date("2026-01-03T00:00:00.000Z");

    expect(await names(stamps.where({ seconds: second }))).toEqual(["b"]);
    expect(await names(stamps.where({ milliseconds: gte(second) }))).toEqual(["b", "c"]);
    expect(await names(stamps.where({ seconds: between(second, third) }))).toEqual(["b", "c"]);
  });

  test("an ISO string is cast, a bad one throws, and null stays NULL", async () => {
    const stamps = connect(binding).model(Stamp);

    await stamps.create({
      name: "a",
      seconds: untyped("2026-01-02T03:04:05Z"),
      milliseconds: null,
    });

    expect(await raw("stamps")).toMatchObject([{ seconds: 1767323045, milliseconds: null }]);
    expect(() => stamps.build({ seconds: untyped("yesterday") })).toThrow(TypeError);
  });

  test("an assignment that stores the same integer isn't a change", async () => {
    await binding.prepare("INSERT INTO stamps VALUES (1, 'a', 1767323045, NULL)").run();
    const [stamp] = await connect(binding).model(Stamp).toArray();

    stamp!.seconds = new Date("2026-01-02T03:04:05.678Z");

    expect(stamp!.isChanged()).toBe(false);
  });
});
