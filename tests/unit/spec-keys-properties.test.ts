import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";
import type { SpecObject } from "../../src/metadata.ts";
import { applyChange, specKeyNames, specProblem } from "../../src/spec-keys.ts";
import { PURE_RUNS } from "../support/properties.ts";

// The rules for each key of an attribute's spec (#164): what a change keeps, drops and replaces,
// and what a spec can't be, stated for any spec and any change.
const initial = () => 1;
const optional = <T>(arbitrary: fc.Arbitrary<T>) => fc.option(arbitrary, { nil: undefined });
const type = fc.constantFrom("string", "integer", "real", "boolean", "datetime", "json");

const spec = fc.record(
  {
    type,
    null: fc.boolean(),
    column: fc.constant("col"),
    default: optional(fc.constant(initial)),
    generateId: optional(fc.boolean()),
    storage: optional(fc.constantFrom("unixSeconds", "unixMilliseconds")),
  },
  { requiredKeys: ["type"] },
) as fc.Arbitrary<SpecObject>;

const change = fc.record(
  {
    type: optional(type),
    null: optional(fc.boolean()),
    default: optional(fc.constant(initial)),
    generateId: optional(fc.boolean()),
    storage: optional(fc.constantFrom("unixSeconds", "unixMilliseconds")),
  },
  { requiredKeys: [] },
);

describe("applying a change to a spec", () => {
  test("gives every key the change gives, and keeps the column", () => {
    fc.assert(
      fc.property(spec, change, (base, given) => {
        const applied = applyChange(base, given);

        for (const [key, value] of Object.entries(given)) {
          if (value !== undefined) expect(applied[key as keyof SpecObject]).toBe(value);
        }
        expect(applied.column).toBe(base.column);
      }),
      PURE_RUNS,
    );
  });

  test("keeps nullability and drops what was written for the old type, on a new type", () => {
    fc.assert(
      fc.property(spec, change, (base, given) => {
        fc.pre(given.type !== undefined && given.type !== base.type);

        const applied = applyChange(base, given);

        expect(applied.null).toBe(given.null ?? base.null);
        expect(applied.default).toBe(given.default);
        expect(applied.generateId).toBe(given.generateId);
        expect(applied.storage).toBe(given.storage);
      }),
      PURE_RUNS,
    );
  });

  test("keeps what it doesn't replace, on the same type", () => {
    fc.assert(
      fc.property(spec, change, (base, given) => {
        fc.pre(given.type === undefined || given.type === base.type);

        const applied = applyChange(base, given);

        expect(applied.storage).toBe(given.storage ?? base.storage);
        // A default and generateId replace each other; `generateId: false` replaces nothing.
        expect(applied.default).toBe(
          given.default ?? (given.generateId === true ? undefined : base.default),
        );
        expect(applied.generateId).toBe(
          given.generateId ?? (given.default === undefined ? base.generateId : undefined),
        );
      }),
      PURE_RUNS,
    );
  });

  test("never leaves a generated id with a default, unless the change gave both", () => {
    fc.assert(
      fc.property(spec, change, (base, given) => {
        fc.pre(!(base.generateId === true && base.default !== undefined));
        fc.pre(!(given.generateId === true && given.default !== undefined));

        const applied = applyChange(base, given);

        expect(applied.generateId === true && applied.default !== undefined).toBe(false);
      }),
      PURE_RUNS,
    );
  });
});

describe("a spec's problems", () => {
  test("a generated id is a string alone, and a storage is a datetime's", () => {
    fc.assert(
      fc.property(spec, (given) => {
        const problem = specProblem("T.a", given);

        const bothGiven = given.generateId === true && given.default !== undefined;
        const generatedNonString = given.generateId === true && given.type !== "string";
        const storedNonDatetime = given.storage !== undefined && given.type !== "datetime";
        expect(problem !== undefined).toBe(bothGiven || generatedNonString || storedNonDatetime);
        if (problem !== undefined) expect(problem.startsWith("T.a ")).toBe(true);
      }),
      PURE_RUNS,
    );
  });

  test("names every key an override may hold, in the order the message lists them", () => {
    expect(specKeyNames).toBe("type, null, default, generateId, storage");
  });
});
