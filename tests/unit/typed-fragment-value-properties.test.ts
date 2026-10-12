import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";
import { column, connect, Model, sql } from "../../src/index.ts";
import { PURE_RUNS } from "../support/properties.ts";
import { values } from "../support/values.ts";

// A typed value in a fragment comes from outside (JSON, a form, a query string), so for a value
// of any shape it's one bound parameter in the attribute's stored form, or a TypeError that names
// the attribute, and it never changes the SQL text (#142).
const declared = {
  label: "string",
  quantity: "integer",
  ratio: "real",
  enabled: "boolean",
  stamp: "datetime",
  seconds: { type: "datetime", storage: "unixSeconds" },
  settings: "json",
} as const;

class Sample extends Model({ id: { type: "integer", null: false }, ...declared }) {
  static tableName = "samples";
}

// No D1 needed: compiling a Relation never queries.
const samples = connect({} as never).model(Sample);
const attributes = Object.keys(declared) as (keyof typeof declared)[];

const compiled = (attribute: string, value: unknown) => {
  const reference = column(attribute);
  return samples.where(sql`${reference} = ${reference.value(value)}`).toSql();
};

describe("a typed value of any shape in a fragment", () => {
  test("is one bound parameter, or a TypeError that names the attribute", () => {
    fc.assert(
      fc.property(fc.constantFrom(...attributes), values, (attribute, value) => {
        try {
          const { params } = compiled(attribute, value);
          expect(params).toHaveLength(1);
          const [param] = params;
          // `JSON.stringify` gives undefined for a function or a symbol: the same gap as below.
          const unserializable = declared[attribute] === "json" && param === undefined;
          expect(
            unserializable || param === null || ["string", "number"].includes(typeof param),
          ).toBe(true);
        } catch (error) {
          expect(error).toBeInstanceOf(TypeError);
          // A json attribute accepts any value, so JSON's own error for one it can't serialize
          // (a BigInt, a cycle), or a bound undefined for a function, is what every write path gives today (#146).
          if (declared[attribute] !== "json") {
            expect((error as TypeError).message).toMatch(new RegExp(`for "${attribute}"`));
          }
        }
      }),
      PURE_RUNS,
    );
  });

  test("never changes the SQL text", () => {
    fc.assert(
      fc.property(fc.constantFrom(...attributes), values, (attribute, value) => {
        const fixed = compiled(attribute, null).sql;
        try {
          expect(compiled(attribute, value).sql).toBe(fixed);
        } catch (error) {
          expect(error).toBeInstanceOf(TypeError);
        }
      }),
      PURE_RUNS,
    );
  });
});
