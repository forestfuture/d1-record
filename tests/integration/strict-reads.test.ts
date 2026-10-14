import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { connect, Model } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

class Reading extends Model({
  id: { type: "integer", null: false },
  label: "string",
  quantity: "integer",
  ratio: "real",
  enabled: "boolean",
  stamp: "datetime",
  seconds: { type: "datetime", storage: "unixSeconds" },
  secret: "integer",
}) {
  static tableName = "strict_reads";
  static override filterAttributes = ["secret"];
}

describe("a stored cell that isn't the attribute's type fails when it's read (#159)", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
    // No declared types, so SQLite keeps each value as it was bound: no column affinity converts.
    await binding
      .prepare(
        "CREATE TABLE strict_reads (id INTEGER PRIMARY KEY, label, quantity, ratio, enabled, stamp, seconds, secret)",
      )
      .run();
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.prepare("DELETE FROM strict_reads").run();
  });

  const readings = () => connect(binding).model(Reading);
  const insertCell = (column: string, cell: unknown, id = 1) =>
    binding.prepare(`INSERT INTO strict_reads (id, ${column}) VALUES (?, ?)`).bind(id, cell).run();

  const refused = [
    ["enabled", 2, "2 isn't a boolean"],
    ["enabled", "1", `"1" isn't a boolean`],
    ["enabled", "true", `"true" isn't a boolean`],
    ["quantity", 1.5, "1.5 isn't an integer"],
    ["quantity", "abc", `"abc" isn't an integer`],
    ["quantity", "42", `"42" isn't an integer`],
    ["quantity", Number.MAX_SAFE_INTEGER + 1, "9007199254740992 isn't an integer"],
    ["ratio", "abc", `"abc" isn't a real`],
    ["label", 5, "5 isn't a string"],
    ["stamp", "garbage", `"garbage" isn't a datetime`],
    ["stamp", "12", `"12" isn't a datetime`],
    ["stamp", "2026-02-30 03:04:05", `"2026-02-30 03:04:05" isn't a datetime`],
    ["stamp", 1767323045, "1767323045 isn't a datetime"],
    ["seconds", "abc", `"abc" isn't a datetime`],
    ["seconds", "", `"" isn't a datetime`],
    ["seconds", "1767323045", `"1767323045" isn't a datetime`],
  ] as const;

  describe.each(refused)("%s holding %j", (column, cell, shown) => {
    const error = new TypeError(`Reading: ${shown} for "${column}"`);

    test("fails find, naming the Model and attribute", async () => {
      await insertCell(column, cell);

      await expect(readings().find(1)).rejects.toThrow(error);
    });

    test("fails a list whole, and pluck, as a load does", async () => {
      await insertCell("label", "fine", 1);
      await insertCell(column, cell, 2);

      await expect(readings().toArray()).rejects.toThrow(error);
      await expect(readings().pluck(column)).rejects.toThrow(error);
    });
  });

  test("by reload", async () => {
    await insertCell("enabled", 1);
    const reading = await readings().find(1);
    await binding.prepare("UPDATE strict_reads SET enabled = 2 WHERE id = 1").run();

    await expect(reading.reload()).rejects.toThrow(
      new TypeError(`Reading: 2 isn't a boolean for "enabled"`),
    );
  });

  test("hides a filtered attribute's cell, by find and by pluck", async () => {
    await insertCell("secret", "hunter2");
    const error = new TypeError(`Reading: [FILTERED] isn't an integer for "secret"`);

    await expect(readings().find(1)).rejects.toThrow(error);
    await expect(readings().pluck("secret")).rejects.toThrow(error);
  });

  describe("reads what is a value of the type", () => {
    test("0 and 1 as booleans, whole numbers, a real that is whole, and NULL", async () => {
      await binding
        .prepare(
          "INSERT INTO strict_reads (id, label, quantity, ratio, enabled) VALUES (1, 'a', 7, 3, 0), (2, 'b', -7, 1.5, 1), (3, NULL, NULL, NULL, NULL)",
        )
        .run();

      const rows = await readings().order({ id: "asc" }).toArray();

      expect(rows.map((row) => [row.label, row.quantity, row.ratio, row.enabled])).toEqual([
        ["a", 7, 3, false],
        ["b", -7, 1.5, true],
        [null, null, null, null],
      ]);
    });

    test.each([
      ["2026-01-02T03:04:05.678Z", "2026-01-02T03:04:05.678Z"],
      ["2026-01-02T05:04:05+02:00", "2026-01-02T03:04:05.000Z"],
      ["2026-01-02 03:04:05", "2026-01-02T03:04:05.000Z"],
      ["2026-01-02", "2026-01-02T00:00:00.000Z"],
    ])("an ISO datetime held as %s", async (cell, iso) => {
      await insertCell("stamp", cell);

      expect((await readings().find(1)).stamp).toEqual(new Date(iso));
    });

    test("a Unix time, whole or fractional", async () => {
      await insertCell("seconds", 1767323045.5);

      expect((await readings().find(1)).seconds).toEqual(new Date(1767323045500));
    });

    test("a date past year 9999, as a save wrote it", async () => {
      const far = new Date("+010000-01-01T00:00:00.000Z");
      await readings().create({ id: 1, stamp: far });

      expect((await readings().find(1)).stamp).toEqual(far);
    });
  });
});
