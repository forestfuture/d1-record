import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";
import { connect, Model } from "../../src/index.ts";
import { PURE_RUNS } from "../support/properties.ts";
import { values } from "../support/values.ts";

// Assigned values come from outside (JSON, a form, a query string), so for a value of any shape an
// attribute is the type it declares or the assignment is refused, and the refusal is a TypeError
// that names the attribute and shows little of the value (#81, #122).
const declared = {
  label: "string",
  quantity: "integer",
  ratio: "real",
  enabled: "boolean",
  stamp: "datetime",
  settings: "json",
} as const;

class Sample extends Model({ id: { type: "integer", null: false }, ...declared }) {
  static tableName = "samples";
}

// No D1 needed: building a record casts what's assigned and never queries.
const samples = connect({} as never).model(Sample);

type Attribute = keyof typeof declared;
const attributes = Object.keys(declared) as Attribute[];

/** The two refusals: a value that isn't the type, and `undefined` (which isn't NULL). */
function refusal(attribute: Attribute): RegExp {
  const noun = declared[attribute] === "json" ? "JSON value" : declared[attribute];
  const type = `isn't an? ${noun} for "${attribute}"`;
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
    case "json":
      // The definition, not an independent check: a json value is what JSON can write (#146).
      // What the property tests is that nothing else gets through, and that the refusal is a
      // TypeError naming the attribute.
      try {
        return JSON.stringify(value) !== undefined;
      } catch {
        return false;
      }
  }
}

const runs = PURE_RUNS;

/** How much of a value an error shows (`SHOWN_LENGTH` in src/attribute-values.ts). */
const SHOWN_LENGTH = 60;

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
          // The value as the message shows it: up to 60 characters, and an ellipsis after them.
          const shown = /^Sample: (.*) isn't an? [\w ]+ for "\w+"$/s.exec(
            (error as Error).message,
          )?.[1];
          if (shown !== undefined) expect(shown.length).toBeLessThanOrEqual(SHOWN_LENGTH + 1);
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
