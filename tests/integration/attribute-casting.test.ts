import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { connect, Model } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

class Sample extends Model({
  id: { type: "integer", null: false },
  label: "string",
  quantity: "integer",
  ratio: "real",
  enabled: "boolean",
  stamp: "datetime",
  settings: "json",
}) {
  static tableName = "samples";
}

/** A value as the error shows it: JSON, with numbers as written (`NaN`, `Infinity`). */
const shown = (value: unknown) =>
  typeof value === "number" ? String(value) : JSON.stringify(value);

/** Assigns a value no TypeScript type allows, as JSON, a form or a query string can (#81). */
const untyped = (value: unknown) => value as never;

describe("values assigned to attributes are cast to the attribute's type (#81)", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  const samples = () => connect(binding).model(Sample);

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.prepare("DELETE FROM samples").run();
  });

  /** Saves `value` as the attribute, and what it reads as before saving and after reloading. */
  async function roundTrip(attribute: keyof Sample & string, value: unknown) {
    const sample = samples().build({ [attribute]: untyped(value) });
    const assigned = sample[attribute];
    await sample.saveOrThrow();
    const reloaded = await samples().find(sample.id);
    return [assigned, reloaded[attribute]];
  }

  describe("boolean", () => {
    test.each([
      [true, true],
      [false, false],
      [1, true],
      [0, false],
      ["1", true],
      ["0", false],
      ["true", true],
      ["false", false],
      ["TRUE", true],
      ["False", false],
      ["on", true],
      ["off", false],
    ])("%j is %j", async (value, expected) => {
      expect(await roundTrip("enabled", value)).toEqual([expected, expected]);
    });

    test.each([["no"], ["yes"], ["t"], ["f"], [""], [" true"], [2], [-1], [{}], [[]]])(
      "%j is refused",
      (value: unknown) => {
        expect(() => samples().build({ enabled: untyped(value) })).toThrow(
          new TypeError(`Sample: ${shown(value)} isn't a boolean for "enabled"`),
        );
      },
    );

    test("a setter casts as it assigns, and refuses without changing the attribute", () => {
      const sample = samples().build({ enabled: true });

      sample.enabled = untyped("false");
      expect(sample.enabled).toBe(false);
      expect(() => (sample.enabled = untyped("no"))).toThrow(TypeError);
      expect(sample.enabled).toBe(false);
    });

    test("assign, update and create cast too", async () => {
      const created = await samples().create({ enabled: untyped("false") });
      expect(created.enabled).toBe(false);

      created.assign({ enabled: untyped("on") });
      expect(created.enabled).toBe(true);

      await created.update({ enabled: untyped("0") });
      expect((await samples().find(created.id)).enabled).toBe(false);
    });

    test("null is still NULL", async () => {
      expect(await roundTrip("enabled", null)).toEqual([null, null]);
    });
  });

  describe("integer", () => {
    test.each([
      [42, 42],
      [-7, -7],
      [0, 0],
      ["42", 42],
      [" 42 ", 42],
      ["-7", -7],
      ["+3", 3],
      [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    ])("%j is %j", async (value, expected) => {
      expect(await roundTrip("quantity", value)).toEqual([expected, expected]);
    });

    test.each([
      [1.7],
      ["12abc"],
      ["1 OR 1=1"],
      ["1e3"],
      ["1.0"],
      [""],
      [" "],
      [Number.NaN],
      [Number.POSITIVE_INFINITY],
      [Number.MAX_SAFE_INTEGER + 1],
      [true],
      [{}],
    ])("%j is refused", (value: unknown) => {
      expect(() => samples().build({ quantity: untyped(value) })).toThrow(
        new TypeError(`Sample: ${shown(value)} isn't an integer for "quantity"`),
      );
    });
  });

  describe("string", () => {
    test.each([["hello"], [""], [" spaced "], ["42"]])("%j is kept", async (value) => {
      expect(await roundTrip("label", value)).toEqual([value, value]);
    });

    test.each([[5], [true], [{ a: 1 }], [["a"]], [new Date(0)]])(
      "%j is refused",
      (value: unknown) => {
        expect(() => samples().build({ label: untyped(value) })).toThrow(
          new TypeError(`Sample: ${shown(value)} isn't a string for "label"`),
        );
      },
    );
  });

  describe("datetime", () => {
    const at = (iso: string) => new Date(iso);

    test.each([
      [at("2026-01-02T03:04:05.678Z"), at("2026-01-02T03:04:05.678Z")],
      ["2026-01-02", at("2026-01-02T00:00:00.000Z")],
      ["2026-01-02T03:04:05Z", at("2026-01-02T03:04:05.000Z")],
      ["2026-01-02T03:04:05.678Z", at("2026-01-02T03:04:05.678Z")],
      ["2026-01-02T03:04Z", at("2026-01-02T03:04:00.000Z")],
      ["2026-01-02T05:04:05+02:00", at("2026-01-02T03:04:05.000Z")],
      ["2026-01-02 03:04:05-01:30", at("2026-01-02T04:34:05.000Z")],
    ])("%j is %j", async (value, expected) => {
      expect(await roundTrip("stamp", value)).toEqual([expected, expected]);
    });

    test.each([
      [new Date(Number.NaN)],
      ["2026-01-02T03:04:05"], // no offset: whose 3am?
      ["2026-02-30"],
      ["2026-13-01"],
      ["02/01/2026"],
      ["Jan 2, 2026"],
      ["not a date"],
      [""],
      [1_767_225_600_000],
      [true],
    ])("%j is refused", (value: unknown) => {
      const text = value instanceof Date ? "Invalid Date" : shown(value);
      expect(() => samples().build({ stamp: untyped(value) })).toThrow(
        new TypeError(`Sample: ${text} isn't a datetime for "stamp"`),
      );
    });
  });

  describe("real", () => {
    test.each([
      [0.5, 0.5],
      [3, 3],
      ["1.5", 1.5],
      [" -2.25 ", -2.25],
      ["-2e3", -2000],
      [".5", 0.5],
      ["5.", 5],
      ["42", 42],
    ])("%j is %j", async (value, expected) => {
      expect(await roundTrip("ratio", value)).toEqual([expected, expected]);
    });

    test.each([["1.5x"], ["0x10"], [""], ["."], [Number.NaN], [Number.NEGATIVE_INFINITY], [false]])(
      "%j is refused",
      (value: unknown) => {
        expect(() => samples().build({ ratio: untyped(value) })).toThrow(
          new TypeError(`Sample: ${shown(value)} isn't a real for "ratio"`),
        );
      },
    );
  });

  // Bulk writes have no record: they cast what they're given, as a record casts what it's assigned.
  describe("bulk writes", () => {
    const enabled = async () =>
      (await samples().order({ id: "asc" }).pluck("enabled")) as unknown[];

    test("insert, insertAll, upsert and upsertAll cast each value", async () => {
      await samples().insert({ id: 1, enabled: untyped("false") });
      await samples().insertAll([{ id: 2, enabled: untyped("on") }]);
      await samples().upsert({ id: 1, enabled: untyped("1") }, { uniqueBy: "id" });
      await samples().upsertAll([{ id: 3, enabled: untyped("0") }], { uniqueBy: "id" });

      expect(await enabled()).toEqual([true, true, false]);
    });

    test("updateAll casts each change", async () => {
      await samples().insertAll([
        { id: 1, enabled: true },
        { id: 2, enabled: true },
      ]);

      expect(
        await samples().updateAll({ enabled: untyped("false"), quantity: untyped(" 3 ") }),
      ).toBe(2);
      expect(await samples().pluck("quantity")).toEqual([3, 3]);
      expect(await enabled()).toEqual([false, false]);
    });

    test("a value that can't be cast is a TypeError, and nothing is written", async () => {
      const error = new TypeError(`Sample: "no" isn't a boolean for "enabled"`);

      await expect(samples().insert({ id: 1, enabled: untyped("no") })).rejects.toThrow(error);
      expect(() => samples().toInsertAll([{ id: 1, enabled: untyped("no") }])).toThrow(error);
      expect(() => samples().toUpsert({ id: 1, enabled: untyped("no") })).toThrow(error);
      expect(() => samples().toUpdateAll({ enabled: untyped("no") })).toThrow(error);
      expect(await samples().count()).toBe(0);
    });
  });
});
