import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { column, connect, Model, sql } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

// An integer-stored attribute, and an ISO one, to show only the first is guarded (#149).
class Stamp extends Model({
  id: { type: "integer", null: false },
  seconds: { type: "datetime", storage: "unixSeconds" },
  milliseconds: { type: "datetime", storage: "unixMilliseconds" },
  iso: "datetime",
}) {
  static tableName = "guarded_stamps";
}

/** A fragment from its text pieces and values, so an operator can vary. */
function fragment(strings: string[], ...values: unknown[]) {
  return sql(Object.assign([...strings], { raw: strings }) as TemplateStringsArray, ...values);
}

describe("a bare date beside an integer-stored column in a fragment (#149)", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
    await binding
      .prepare(
        "CREATE TABLE guarded_stamps (id INTEGER PRIMARY KEY, seconds INTEGER, milliseconds INTEGER, iso TEXT)",
      )
      .run();
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.prepare("DELETE FROM guarded_stamps").run();
  });

  const stamps = () => connect(binding).model(Stamp);
  const seconds = column("seconds");
  const milliseconds = column("milliseconds");
  const iso = column("iso");
  const day = new Date("2026-01-02T00:00:00.000Z");
  const refusal = (attribute: string, storage: string, what = "Date") =>
    new TypeError(
      `Stamp: a ${what} compared with "${attribute}", which is stored as ${storage}, is ISO text and won't compare. Use column("${attribute}").value(…) for it.`,
    );

  test("a bare Date after the column throws TypeError when the fragment is used", () => {
    expect(() => stamps().where(sql`${seconds} > ${day}`)).toThrow(
      refusal("seconds", "unixSeconds"),
    );
  });

  test.each(["=", "==", "<>", "!=", "<", "<=", ">", ">="])(
    "the comparison %s is refused",
    (operator) => {
      expect(() => stamps().where(fragment(["", ` ${operator} `, ""], seconds, day))).toThrow(
        refusal("seconds", "unixSeconds"),
      );
    },
  );

  test("a bare Date before the column is refused", () => {
    expect(() => stamps().where(sql`${day} < ${milliseconds}`)).toThrow(
      refusal("milliseconds", "unixMilliseconds"),
    );
  });

  test("BETWEEN, with a bare Date for either bound, is refused", () => {
    expect(() => stamps().where(sql`${seconds} BETWEEN ${day} AND ${5}`)).toThrow(TypeError);
    expect(() => stamps().where(sql`${seconds} NOT BETWEEN ${5} AND ${day}`)).toThrow(TypeError);
  });

  test("a string that is an ISO datetime is refused as a Date is", () => {
    expect(() => stamps().where(sql`${seconds} > ${"2026-01-02T00:00:00Z"}`)).toThrow(
      refusal("seconds", "unixSeconds", "string"),
    );
  });

  test("updateAll refuses it too, where it would write ISO text into an integer column", async () => {
    await expect(stamps().updateAll(sql`${seconds} = ${day}`)).rejects.toThrow(
      refusal("seconds", "unixSeconds"),
    );
  });

  test("an order fragment is checked as a condition is", () => {
    expect(() => stamps().order(sql`${seconds} = ${day}`)).toThrow(TypeError);
  });

  test("the typed value beside the column is fine", async () => {
    await binding.prepare("INSERT INTO guarded_stamps VALUES (1, 1767312000, NULL, NULL)").run();

    const count = await stamps()
      .where(sql`${seconds} >= ${seconds.value(day)}`)
      .count();

    expect(count).toBe(1);
  });

  test("a bare number beside the column is fine", () => {
    expect(() => stamps().where(sql`${seconds} > ${1767225600}`)).not.toThrow();
  });

  test("a string that isn't a datetime beside the column is fine", () => {
    expect(() => stamps().where(sql`${seconds} = ${"abc"}`)).not.toThrow();
  });

  test("a bare Date beside an ISO datetime attribute's column is fine", () => {
    expect(() => stamps().where(sql`${iso} > ${day}`)).not.toThrow();
  });

  test("an expression around the column isn't judged", () => {
    expect(() => stamps().where(sql`abs(${seconds} - ${day}) < ${5}`)).not.toThrow();
  });

  test("two columns compared are fine", () => {
    expect(() => stamps().where(sql`${seconds} = ${milliseconds}`)).not.toThrow();
  });
});
