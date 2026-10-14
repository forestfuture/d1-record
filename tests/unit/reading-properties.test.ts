import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";
import { Model } from "../../src/index.ts";
import { PURE_RUNS } from "../support/properties.ts";
import { values } from "../support/values.ts";

// A cell D1 returned comes from outside the library too (another writer, an old migration, a
// column declared one way and used another), so for a cell of any shape an attribute reads as the
// type it declares or the read is refused with a TypeError that names the attribute (#159).
const declared = {
  label: "string",
  quantity: "integer",
  ratio: "real",
  enabled: "boolean",
  stamp: "datetime",
  seconds: { type: "datetime", storage: "unixSeconds" },
  milliseconds: { type: "datetime", storage: "unixMilliseconds" },
  settings: "json",
} as const;

class Sample extends Model({ id: { type: "integer", null: false }, ...declared }) {
  static tableName = "samples";
}

type Attribute = keyof typeof declared;
const attributes = Object.keys(declared) as Attribute[];

/** What D1 can return for a cell, beside the arbitrary values every attribute is tried with. */
const cells = fc.oneof(
  values,
  fc.constantFrom(
    "2026-01-02",
    "2026-01-02T03:04:05.678Z",
    "2026-01-02 03:04:05",
    "2026-02-30 03:04:05",
    "12",
    "garbage",
    "",
    '{"a":1}',
    0,
    1,
    2,
    1.5,
    1767323045,
    8.64e15,
    9e15,
    new Uint8Array([1, 2, 3]),
    [1, 2, 3],
    true,
  ),
);

const attempt = (
  run: () => unknown,
): { ok: true; value: unknown } | { ok: false; error: Error } => {
  try {
    return { ok: true, value: run() };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
};

/** Whether `read` is a JavaScript value of the type the attribute declares. */
function isOfType(attribute: Attribute, read: unknown): boolean {
  const type = declared[attribute];
  switch (typeof type === "string" ? type : "datetime") {
    case "string":
      return typeof read === "string";
    case "integer":
      return Number.isSafeInteger(read);
    case "real":
      return Number.isFinite(read);
    case "boolean":
      return typeof read === "boolean";
    case "datetime":
      return read instanceof Date && !Number.isNaN(read.getTime());
    default:
      return true;
  }
}

/** The one thing a refusal says: the Model, the cell, and which attribute it isn't a value of. */
const refusal = (attribute: Attribute) =>
  new RegExp(`^Sample: .* isn't an? [\\w ]+ for "${attribute}"$`, "s");

describe("reading a cell of any shape as an attribute", () => {
  test("gives the attribute's type or is refused with a TypeError that names it", () => {
    fc.assert(
      fc.property(fc.constantFrom(...attributes), cells, (attribute, cell) => {
        const read = attempt(() => Sample.typeForAttribute(attribute).deserialize(cell));

        if (read.ok) {
          expect(read.value === null || isOfType(attribute, read.value)).toBe(true);
        } else {
          expect(read.error).toBeInstanceOf(TypeError);
          expect(read.error.message).toMatch(refusal(attribute));
        }
      }),
      PURE_RUNS,
    );
  });

  test("keeps what a cell holds: a boolean is 0 or 1, an integer is the integer", () => {
    fc.assert(
      fc.property(cells, (cell) => {
        const boolean = attempt(() => Sample.typeForAttribute("enabled").deserialize(cell));
        const integer = attempt(() => Sample.typeForAttribute("quantity").deserialize(cell));

        // Compared with ===, so a cell of -0 is the 0 it is.
        if (boolean.ok && boolean.value !== null) {
          expect(cell === (boolean.value ? 1 : 0)).toBe(true);
        }
        if (integer.ok && integer.value !== null) expect(integer.value === cell).toBe(true);
      }),
      PURE_RUNS,
    );
  });

  test("never reads a number as an ISO datetime, or text as a Unix time", () => {
    fc.assert(
      fc.property(cells, (cell) => {
        const iso = attempt(() => Sample.typeForAttribute("stamp").deserialize(cell));
        const seconds = attempt(() => Sample.typeForAttribute("seconds").deserialize(cell));
        const milliseconds = attempt(() =>
          Sample.typeForAttribute("milliseconds").deserialize(cell),
        );

        if (typeof cell === "number") expect(iso.ok).toBe(false);
        if (typeof cell !== "number" && cell !== null && cell !== undefined) {
          expect(seconds.ok).toBe(false);
          expect(milliseconds.ok).toBe(false);
        }
      }),
      PURE_RUNS,
    );
  });
});
