import fc from "fast-check";
import { describe, test } from "vite-plus/test";
import { camelize, underscore } from "../../src/naming.ts";
import { originalUnderscore } from "../support/naming-oracle.ts";

// Names reach these functions from a request (an error added under a submitted key), so they're
// checked on strings nobody wrote by hand: ones built from the characters the rules look at, and
// ones of any UTF-16 code unit, lone surrogates included (#122).
const ruleCharacters = fc.string({
  unit: fc.constantFrom("a", "b", "z", "A", "B", "Z", "0", "9", "_", "-", " "),
  maxLength: 60,
});
const anyCharacters = fc.string({ unit: "binary", maxLength: 60 });
const names = fc.oneof(ruleCharacters, anyCharacters);

// Pure functions: a thousand names each, well under a second (#122).
const runs = { numRuns: 1000 };

describe("underscore, for any name", () => {
  test("gives the names the original two-rule definition gives", () => {
    fc.assert(
      fc.property(names, (name) => underscore(name) === originalUnderscore(name)),
      runs,
    );
  });

  test("gives lowercase, and leaves a lowercase name as it is", () => {
    fc.assert(
      fc.property(names, (name) => {
        const column = underscore(name);
        return column === column.toLowerCase() && underscore(column) === column;
      }),
      runs,
    );
  });
});

/** The rule read one character at a time: an underscore before a lowercase letter or digit goes. */
function camelizedByHand(name: string): string {
  let result = "";
  for (let index = 0; index < name.length; index++) {
    const next = name[index + 1];
    if (name[index] === "_" && next !== undefined && /[a-z\d]/.test(next)) {
      result += next.toUpperCase();
      index++;
    } else {
      result += name[index];
    }
  }
  return result;
}

describe("camelize, for any name", () => {
  test("drops each underscore that comes before a lowercase letter or digit, and no other", () => {
    fc.assert(
      fc.property(names, (name) => camelize(name) === camelizedByHand(name)),
      runs,
    );
  });

  test("never makes the name longer", () => {
    fc.assert(
      fc.property(names, (name) => camelize(name).length <= name.length),
      runs,
    );
  });
});
