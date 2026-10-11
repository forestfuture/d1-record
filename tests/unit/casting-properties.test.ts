import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";
import { connect, Model } from "../../src/index.ts";

// Assigned values come from outside (JSON, a form, a query string), so for a value of any shape an
// attribute is the type it declares or the assignment is refused, and the refusal is a TypeError
// that names the attribute and shows little of the value (#81, #122).
const declared = {
  label: "string",
  quantity: "integer",
  ratio: "real",
  enabled: "boolean",
  stamp: "datetime",
} as const;

class Sample extends Model({ id: { type: "integer", null: false }, ...declared }) {
  static tableName = "samples";
}

// No D1 needed: building a record casts what's assigned and never queries.
const samples = connect({} as never).model(Sample);

type Attribute = keyof typeof declared;
const attributes = Object.keys(declared) as Attribute[];

/** Values of every shape a request can carry, and a few that only code can: BigInt, `Symbol`, … */
const values = fc.oneof(
  fc.anything({
    withBigInt: true,
    withDate: true,
    withNullPrototype: true,
    withBoxedValues: true,
    withTypedArray: true,
    withSparseArray: true,
  }),
  fc.string({ unit: "binary", maxLength: 200 }),
  fc.double(),
  fc.integer().map(String),
  fc.double().map(String),
  fc.date({ noInvalidDate: false }),
  fc.constantFrom(
    "",
    " ",
    "1e3",
    "0x10",
    -0,
    Number.MAX_SAFE_INTEGER + 1,
    Symbol("value"),
    () => 1,
    undefined,
  ),
);

/** The two refusals: a value that isn't the type, and `undefined` (which isn't NULL). */
function refusal(attribute: Attribute): RegExp {
  const type = `isn't an? ${declared[attribute]} for "${attribute}"`;
  const missing = `got undefined for "${attribute}"; use null to store NULL`;
  return new RegExp(`^Sample: (?:.* ${type}|${missing})$`, "s");
}

/** Whether `value` is a JavaScript value of the attribute's declared type. */
function isOfType(attribute: Attribute, value: unknown): boolean {
  switch (declared[attribute]) {
    case "string":
      return typeof value === "string";
    case "integer":
      return Number.isSafeInteger(value);
    case "real":
      return Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "datetime":
      return value instanceof Date && !Number.isNaN(value.getTime());
  }
}

// A thousand values per property; building a record is cheap and needs no database.
const runs = { numRuns: 1000 };

describe("assigning a value of any shape to an attribute", () => {
  test("gives the attribute's type or is refused with a TypeError that names it", () => {
    fc.assert(
      fc.property(fc.constantFrom(...attributes), values, (attribute, value) => {
        let built: Sample;
        try {
          built = samples.build({ [attribute]: value as never });
        } catch (error) {
          expect(error).toBeInstanceOf(TypeError);
          expect((error as TypeError).message).toMatch(refusal(attribute));
          return;
        }
        const stored = built[attribute];
        expect(stored === null || isOfType(attribute, stored)).toBe(true);
      }),
      runs,
    );
  });

  test("shows at most 60 characters of the value in the error", () => {
    fc.assert(
      fc.property(fc.constantFrom(...attributes), values, (attribute, value) => {
        try {
          samples.build({ [attribute]: value as never });
        } catch (error) {
          // "Sample: " and ` isn't a datetime for "quantity"` around the shown value and its …
          expect((error as Error).message.length).toBeLessThanOrEqual(61 + 60);
        }
      }),
      runs,
    );
  });

  // JSON can't serialize the BigInt, and the object has no string form (no prototype), so the
  // error's text for the value has nothing to fall back to but its tag (#122).
  test("refuses a value that has no JSON and no string form, as it refuses any other", () => {
    const value = [Object.create(null), 0n];

    expect(() => samples.build({ label: value as never })).toThrow(
      new TypeError(`Sample: [object Array] isn't a string for "label"`),
    );
  });

  test("keeps null as null, whatever the type", () => {
    for (const attribute of attributes) {
      expect(samples.build({ [attribute]: null as never })[attribute]).toBeNull();
    }
  });
});
