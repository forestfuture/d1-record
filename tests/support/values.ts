import fc from "fast-check";

/** Values of every shape a request can carry, and a few that only code can: BigInt, `Symbol`, … */
export const values = fc.oneof(
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
