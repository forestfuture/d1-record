import fc from "fast-check";
import { runInThisContext } from "node:vm";
import { describe, expect, test } from "vite-plus/test";
import { renderSchema } from "../../cli/schema/render.ts";
import { schemaOf } from "../../cli/schema/schema.ts";

// A column's JSON default is data the generator copies into source: whatever it holds, the
// generated default must be that value, key for key (#119, #122).
const keys = fc.oneof(
  fc.constantFrom("__proto__", "constructor", "toString", "prototype", "a", "b", "0", "1"),
  fc.string({ maxLength: 6 }),
);

/** A JSON value, with the keys that mean something to an object among the object keys. */
const jsonValues = fc.letrec<{ value: unknown; array: unknown[]; object: object }>((tie) => ({
  value: fc.oneof(
    { depthSize: "small" },
    fc.constant(null),
    fc.boolean(),
    fc.integer(),
    fc.double({ noNaN: true, noDefaultInfinity: true }).filter((number) => !Object.is(number, -0)),
    fc.string({ maxLength: 8 }),
    tie("array"),
    tie("object"),
  ),
  array: fc.array(tie("value"), { maxLength: 3 }),
  object: fc
    .array(fc.tuple(keys, tie("value")), { maxLength: 3 })
    // fromEntries makes `__proto__` an own key, as JSON.parse does.
    .map((entries) => Object.fromEntries(entries)),
})).value;

/** The generated schema.ts as a value: its `export`s and `as const`s dropped, then run. */
function generated(source: string): Record<string, { attributes: Record<string, unknown> }> {
  const code = source.replace(/^export const /gm, "const ").replace(/ as const;/g, ";");
  return runInThisContext(`(() => {\n${code}\nreturn tables;\n})()`) as never;
}

/** The `default` of a JSON column that a migration declares with `value` as its default. */
function defaultOf(value: unknown): unknown {
  const text = JSON.stringify(value).replaceAll("'", "''");
  const sql = `CREATE TABLE things (
    id INTEGER PRIMARY KEY,
    settings TEXT CHECK (json_valid(settings)) DEFAULT '${text}'
  );`;
  const result = schemaOf([{ name: "0001_create.sql", sql }]);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  const settings = generated(renderSchema(result.tables, "migrations/")).things!.attributes
    .settings as { default: () => unknown };
  return settings.default();
}

describe("a JSON column's default, in the generated schema", () => {
  test("is the value the migration declared, key for key", () => {
    fc.assert(
      fc.property(jsonValues, (value) => {
        // JSON text compares key order and every own key; `toEqual` would forgive a prototype.
        expect(JSON.stringify(defaultOf(value))).toBe(JSON.stringify(value));
      }),
      { numRuns: 500 },
    );
  });

  test("keeps a __proto__ key as a key, not as the object's prototype (#119)", () => {
    const value = JSON.parse('{"__proto__":{"a":1},"b":2}') as object;
    const result = defaultOf(value) as Record<string, unknown>;

    expect(Object.keys(result).sort()).toEqual(["__proto__", "b"]);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });
});
