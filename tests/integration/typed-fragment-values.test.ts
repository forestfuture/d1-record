import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  column,
  connect,
  IncompatibleRelation,
  Model,
  sql,
  UnknownAttribute,
} from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

// Attributes of every type, to show the value is written as each stores it.
class Sample extends Model({
  id: { type: "integer", null: false },
  label: "string",
  enabled: "boolean",
  settings: "json",
  stamp: "datetime",
  secret: "string",
}) {
  static tableName = "typed_samples";
  static override filterAttributes = ["secret"];
}

// An attribute stored as a Unix time: a plain Date interpolated into a fragment is ISO text.
class Stamp extends Model({
  id: { type: "integer", null: false },
  name: "string",
  seconds: { type: "datetime", storage: "unixSeconds" },
  milliseconds: { type: "datetime", storage: "unixMilliseconds" },
}) {
  static tableName = "stamps";
}

describe("a typed value in an sql fragment (#142)", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
    await binding
      .prepare(
        "CREATE TABLE stamps (id INTEGER PRIMARY KEY, name TEXT, seconds INTEGER, milliseconds INTEGER)",
      )
      .run();
    await binding
      .prepare(
        "CREATE TABLE typed_samples (id INTEGER PRIMARY KEY, label TEXT, enabled INTEGER, settings TEXT, stamp TEXT, secret TEXT)",
      )
      .run();
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.batch([
      binding.prepare("DELETE FROM stamps"),
      binding.prepare("DELETE FROM typed_samples"),
      binding.prepare("INSERT INTO stamps VALUES (1, 'a', 1767225600, 1767225600000)"),
      binding.prepare("INSERT INTO stamps VALUES (2, 'b', 1767312000, 1767312000000)"),
      binding.prepare("INSERT INTO stamps VALUES (3, 'c', 1767398400, 1767398400000)"),
    ]);
  });

  const names = async (relation: { toArray(): Promise<Stamp[]> }) =>
    (await relation.toArray()).map((stamp) => stamp.name ?? "");
  // One database, since `or` needs its relations on the same one.
  let shared: ReturnType<typeof connect>;
  beforeEach(() => {
    shared = connect(binding);
  });
  const stamps = () => shared.model(Stamp).order({ id: "asc" });

  test("a Date as an integer-stored attribute's value compares with its column", async () => {
    const second = new Date("2026-01-02T00:00:00.000Z");
    const seconds = column("seconds");
    const milliseconds = column("milliseconds");

    expect(await names(stamps().where(sql`${seconds} >= ${seconds.value(second)}`))).toEqual([
      "b",
      "c",
    ]);
    expect(
      await names(stamps().where(sql`${milliseconds} < ${milliseconds.value(second)}`)),
    ).toEqual(["a"]);
  });

  test("an ISO datetime, a boolean and json are written as those attributes store them", async () => {
    await binding
      .prepare(
        `INSERT INTO typed_samples VALUES (1, 'a', 1, '{"theme":"dark"}', '2026-01-02T03:04:05.000Z', NULL)`,
      )
      .run();
    const samples = connect(binding).model(Sample);
    const enabled = column("enabled");
    const settings = column("settings");
    const stamp = column("stamp");
    const count = (condition: ReturnType<typeof sql>) => samples.where(condition).count();

    expect(await count(sql`${enabled} = ${enabled.value("on")}`)).toBe(1);
    expect(await count(sql`${settings} = ${settings.value({ theme: "dark" })}`)).toBe(1);
    expect(await count(sql`${stamp} = ${stamp.value(new Date("2026-01-02T03:04:05.000Z"))}`)).toBe(
      1,
    );
  });

  test("a value the attribute can't cast throws TypeError naming the Model and attribute", () => {
    const seconds = column("seconds");
    const condition = sql`${seconds} > ${seconds.value("yesterday")}`;

    expect(() => stamps().where(condition).toSql()).toThrow(
      new TypeError('Stamp: "yesterday" isn\'t a datetime for "seconds"'),
    );
  });

  test("an attribute the Model doesn't have is UnknownAttribute when the fragment is used", () => {
    // Alone: a column() beside it would already be checked.
    const condition = sql`seconds > ${column("nope").value(1)}`;

    expect(() => stamps().where(condition)).toThrow(UnknownAttribute);
  });

  test("a filtered attribute's value is hidden from onQuery, and D1 still gets it", async () => {
    await binding.prepare("INSERT INTO typed_samples (id, secret) VALUES (1, 's3cret')").run();
    const events: { params: unknown[] }[] = [];
    const samples = connect(binding, { onQuery: (event) => events.push(event) }).model(Sample);
    const secret = column("secret");

    const found = await samples.where(sql`${secret} = ${secret.value("s3cret")}`).count();

    expect(found).toBe(1);
    expect(JSON.stringify(events.map((event) => event.params))).not.toContain("s3cret");
    expect(JSON.stringify(events.map((event) => event.params))).toContain("[FILTERED]");
  });

  test("it works in updateAll, order and toSql, in the stored form", async () => {
    const milliseconds = column("milliseconds");
    const moment = new Date("2026-02-03T04:05:06.789Z");

    await stamps().updateAll(sql`${milliseconds} = ${milliseconds.value(moment)}`);
    const ordered = await stamps()
      .reorder(sql`abs(${milliseconds} - ${milliseconds.value(moment)})`)
      .toArray();
    const { params } = stamps()
      .where(sql`${milliseconds} > ${milliseconds.value(moment)}`)
      .toSql();

    expect(ordered).toHaveLength(3);
    expect(params).toEqual([moment.getTime()]);
    expect(
      (await binding.prepare("SELECT DISTINCT milliseconds FROM stamps").all()).results,
    ).toEqual([{ milliseconds: moment.getTime() }]);
  });

  test("fragments with equal typed values have the same shape for or, and different ones don't", async () => {
    const milliseconds = column("milliseconds");
    const nearest = (date: Date) =>
      stamps().reorder(sql`abs(${milliseconds} - ${milliseconds.value(date)})`);
    const day = new Date("2026-01-02T00:00:00.000Z");

    const both = nearest(day)
      .where({ name: "a" })
      .or(nearest(new Date(day)).where({ name: "c" }));

    // a and c are the same distance from the day, so their order isn't defined.
    expect((await names(both)).sort((x, y) => x.localeCompare(y))).toEqual(["a", "c"]);
    expect(() =>
      nearest(day)
        .where({ name: "a" })
        .or(nearest(new Date("2026-01-03T00:00:00.000Z")).where({ name: "c" })),
    ).toThrow(IncompatibleRelation);
  });
});
