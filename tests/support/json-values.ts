import fc from "fast-check";

// JSON values for properties (#122): every JSON shape a few levels deep, with the object keys that
// mean something to an object among the keys, and any characters in strings. No -0, which JSON
// writes as 0.

/** Object keys: the ones an object treats specially, numeric-looking ones, and any text. */
export const objectKeys = fc.oneof(
  fc.constantFrom(
    "__proto__",
    "constructor",
    "toString",
    "hasOwnProperty",
    "prototype",
    "a",
    "0",
    "1",
  ),
  fc.string({ maxLength: 12 }),
);

/** Text of printable characters, and of any UTF-16 code unit (JSON escapes a lone surrogate). */
const texts = fc.oneof(fc.string({ maxLength: 40 }), fc.string({ unit: "binary", maxLength: 12 }));

/** A JSON value of any shape. */
export const jsonValues = fc.letrec<{ value: unknown; array: unknown[]; object: object }>(
  (tie) => ({
    value: fc.oneof(
      { depthSize: "medium", maxDepth: 5 },
      fc.constant(null),
      fc.boolean(),
      fc.integer(),
      fc
        .double({ noNaN: true, noDefaultInfinity: true })
        .filter((number) => !Object.is(number, -0)),
      texts,
      tie("array"),
      tie("object"),
    ),
    array: fc.array(tie("value"), { maxLength: 4 }),
    object: fc
      .array(fc.tuple(objectKeys, tie("value")), { maxLength: 4 })
      // fromEntries makes `__proto__` an own key, as JSON.parse does.
      .map((entries) => Object.fromEntries(entries)),
  }),
).value;
