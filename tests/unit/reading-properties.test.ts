import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";
import {
  attempt,
  declared,
  isOfType,
  readRefusal,
  Sample,
  sampleAttributes,
} from "../support/attribute-samples.ts";
import { PURE_RUNS } from "../support/properties.ts";
import { values } from "../support/values.ts";

// A cell D1 returned comes from outside the library too (another writer, an old migration, a
// column declared one way and used another), so for a cell of any shape an attribute reads as the
// type it declares or the read is refused with a TypeError that names the attribute (#159).

/** What D1 can return for a cell, beside the arbitrary values every attribute is tried with. */
const cells = fc.oneof(
  values,
  fc.constantFrom(
    "2026-01-02",
    "2026-01-02T03:04:05.678Z",
    "2026-01-02 03:04:05",
    "2026-02-30 03:04:05",
    "+010000-01-01T00:00:00.000Z",
    "+002026-01-01T00:00:00.000Z",
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

const read = (attribute: keyof typeof declared, cell: unknown) =>
  attempt(() => Sample.typeForAttribute(attribute).deserialize(cell));

describe("reading a cell of any shape as an attribute", () => {
  test("gives the attribute's type or is refused with a TypeError that names it", () => {
    fc.assert(
      fc.property(fc.constantFrom(...sampleAttributes), cells, (attribute, cell) => {
        const result = read(attribute, cell);

        if (!result.ok) {
          expect(result.error).toBeInstanceOf(TypeError);
          expect(result.error.message).toMatch(readRefusal(attribute));
        } else if (attribute === "settings") {
          // A json cell is parsed when it's text, NULL when it's none, and is the value otherwise.
          const unchanged = cell == null ? result.value === null : Object.is(result.value, cell);
          expect(typeof cell === "string" || unchanged).toBe(true);
        } else {
          expect(result.value === null || isOfType(attribute, result.value)).toBe(true);
        }
      }),
      PURE_RUNS,
    );
  });

  test("reads a boolean only from 0 or 1, and an integer as the number it is", () => {
    fc.assert(
      fc.property(cells, (cell) => {
        const boolean = read("enabled", cell);
        const integer = read("quantity", cell);

        // Compared with ===, so a cell of -0 is the 0 it is.
        if (boolean.ok && boolean.value !== null) {
          expect(cell === (boolean.value ? 1 : 0)).toBe(true);
        }
        if (integer.ok && integer.value !== null) expect(integer.value === cell).toBe(true);
      }),
      PURE_RUNS,
    );
  });

  test("reads only text as an ISO datetime", () => {
    fc.assert(
      fc.property(cells, (cell) => {
        if (typeof cell !== "string") expect(read("stamp", cell).ok).toBe(cell == null);
      }),
      PURE_RUNS,
    );
  });

  test("reads only a number as a Unix time", () => {
    fc.assert(
      fc.property(cells, fc.constantFrom("seconds", "milliseconds"), (cell, attribute) => {
        if (typeof cell !== "number") expect(read(attribute, cell).ok).toBe(cell == null);
      }),
      PURE_RUNS,
    );
  });

  test("refuses a day that doesn't exist, even in the form toISOString writes", () => {
    for (const cell of ["2026-02-30T10:00:00.000Z", "2026-13-01T00:00:00.000Z", "2026-02-30"]) {
      expect([cell, read("stamp", cell).ok]).toEqual([cell, false]);
    }
    expect(read("stamp", "2026-02-28T10:00:00.000Z")).toEqual({
      ok: true,
      value: new Date("2026-02-28T10:00:00.000Z"),
    });
  });

  test("reads a far year only in the exact form toISOString writes", () => {
    fc.assert(
      fc.property(
        fc.date({ noInvalidDate: true, min: new Date(-8.64e15), max: new Date(8.64e15) }),
        (date) => {
          const written = Sample.typeForAttribute("stamp").serialize(date);
          expect(Sample.typeForAttribute("stamp").deserialize(written)).toEqual(date);
        },
      ),
      PURE_RUNS,
    );
  });
});
