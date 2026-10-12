import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { column, connect, Model, sql } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

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
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.batch([
      binding.prepare("DELETE FROM stamps"),
      binding.prepare("INSERT INTO stamps VALUES (1, 'a', 1767225600, 1767225600000)"),
      binding.prepare("INSERT INTO stamps VALUES (2, 'b', 1767312000, 1767312000000)"),
      binding.prepare("INSERT INTO stamps VALUES (3, 'c', 1767398400, 1767398400000)"),
    ]);
  });

  const names = async (relation: { toArray(): Promise<Stamp[]> }) =>
    (await relation.toArray()).map((stamp) => stamp.name);
  const stamps = () => connect(binding).model(Stamp).order({ id: "asc" });

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
});
