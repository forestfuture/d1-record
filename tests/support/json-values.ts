import fc from "fast-check";

// JSON values for properties (#122): every JSON shape, with the object keys that mean something
// to an object among the keys, and no -0 (JSON writes it as 0).
const keys = fc.oneof(
  fc.constantFrom("__proto__", "constructor", "toString", "prototype", "a", "b", "0", "1"),
  fc.string({ maxLength: 6 }),
);

/** A JSON value of any shape, a few levels deep. */
export const jsonValues = fc.letrec<{ value: unknown; array: unknown[]; object: object }>(
  (tie) => ({
    value: fc.oneof(
      { depthSize: "small" },
      fc.constant(null),
      fc.boolean(),
      fc.integer(),
      fc
        .double({ noNaN: true, noDefaultInfinity: true })
        .filter((number) => !Object.is(number, -0)),
      fc.string({ maxLength: 8 }),
      tie("array"),
      tie("object"),
    ),
    array: fc.array(tie("value"), { maxLength: 3 }),
    object: fc
      .array(fc.tuple(keys, tie("value")), { maxLength: 3 })
      // fromEntries makes `__proto__` an own key, as JSON.parse does.
      .map((entries) => Object.fromEntries(entries)),
  }),
).value;
