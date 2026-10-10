import { describe, expect, test } from "vite-plus/test";
import { underscore } from "../../src/naming.ts";

/** `underscore` as it was written before #116: two regexes, quadratic on a long run of capitals. */
function original(name: string): string {
  return name
    .replace(/([A-Z\d]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .toLowerCase();
}

// Letters of both cases, a digit and an underscore, so every neighbouring pair the rules look at
// (capital after lowercase, capital after digit, run of capitals before a lowercase) comes up.
const alphabet = ["a", "b", "A", "B", "1", "_"];

/** Every string of up to `maxLength` characters over the alphabet. */
function* strings(maxLength: number): Generator<string> {
  let layer = [""];
  yield "";
  for (let length = 1; length <= maxLength; length++) {
    layer = layer.flatMap((prefix) => alphabet.map((each) => prefix + each));
    yield* layer;
  }
}

describe("underscore", () => {
  test("gives the names Rails' rule gives, for every short string", () => {
    const different: string[] = [];
    for (const name of strings(7)) {
      if (underscore(name) !== original(name)) different.push(name);
      if (different.length === 5) break;
    }

    expect(different).toEqual([]);
  });
});
