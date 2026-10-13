import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";
import { castValue, uncastable } from "../../src/conversion.ts";
import { column, connect, Model, sql } from "../../src/index.ts";
import { PURE_RUNS } from "../support/properties.ts";
import { values } from "../support/values.ts";

// What a fragment is given comes from outside, so the guard (#149) must judge any value: refuse
// exactly a Date or an ISO datetime string beside an integer-stored column, and nothing else.
class Stamp extends Model({
  id: { type: "integer", null: false },
  seconds: { type: "datetime", storage: "unixSeconds" },
  iso: "datetime",
}) {
  static tableName = "stamps";
}

// No D1 needed: building a Relation never queries.
const stamps = connect({} as never).model(Stamp);
const operators = ["=", "==", "<>", "!=", "<", "<=", ">", ">="];

/** `column <operator> value`, built from its pieces so the operator can vary. */
function comparing(attribute: string, operator: string, value: unknown) {
  const strings = ["", ` ${operator} `, ""];
  return sql(
    Object.assign([...strings], { raw: strings }) as TemplateStringsArray,
    column(attribute),
    value,
  );
}

/** Whether a value is one a datetime attribute would cast from outside: a Date, or an ISO string. */
function isBareDatetime(value: unknown): boolean {
  if (value instanceof Date) return true;
  return typeof value === "string" && castValue({ type: "datetime" }, value) !== uncastable;
}

describe("the bare date guard, for a value of any shape", () => {
  test("refuses exactly a Date or an ISO datetime string beside an integer-stored column", () => {
    fc.assert(
      fc.property(fc.constantFrom(...operators), values, (operator, value) => {
        const refused = (() => {
          try {
            stamps.where(comparing("seconds", operator, value));
            return false;
          } catch (error) {
            return error instanceof TypeError;
          }
        })();

        expect(refused).toBe(isBareDatetime(value));
      }),
      PURE_RUNS,
    );
  });

  test("never refuses a value beside an attribute that isn't integer-stored", () => {
    fc.assert(
      fc.property(fc.constantFrom(...operators), values, (operator, value) => {
        expect(() => stamps.where(comparing("iso", operator, value))).not.toThrow();
      }),
      PURE_RUNS,
    );
  });
});
