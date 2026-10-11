import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";
import { Model } from "../../src/index.ts";

class User extends Model({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
  isActive: "boolean",
  age: "integer",
}) {
  static tableName = "users";
}

type Name = "email" | "role" | "isActive" | "age";
const attributeNames: Name[] = ["email", "role", "isActive", "age"];

// A request body as JSON gives it: any keys, including the ones that mean something to an
// object (`__proto__`, `constructor`), as own properties (JSON.parse makes them so), and values
// of any JSON shape (#82, #122).
const keys = fc.oneof(
  fc.constantFrom(
    ...attributeNames,
    "__proto__",
    "constructor",
    "prototype",
    "toString",
    "hasOwnProperty",
    "id",
    "token",
    "isAdmin",
  ),
  fc.string({ maxLength: 12 }),
);
const bodies = fc
  .array(fc.tuple(keys, fc.jsonValue()), { maxLength: 8 })
  .map((entries) => Object.fromEntries(entries));

// The attributes a controller names: some of them, in any order.
const named = fc.subarray(attributeNames, { minLength: 1 });

const runs = { numRuns: 1000 };

describe("Model.permit, for any request body", () => {
  test("returns only the named attributes the body has as its own keys, or is refused", () => {
    fc.assert(
      fc.property(bodies, named, (body, names) => {
        let permitted: Record<string, unknown>;
        try {
          permitted = User.permit(body, ...names) as Record<string, unknown>;
        } catch (error) {
          // A value that isn't the attribute's type is refused, as an assignment is.
          expect(error).toBeInstanceOf(TypeError);
          return;
        }

        const own = names.filter((name) => Object.hasOwn(body, name));
        expect(Object.keys(permitted).sort()).toEqual([...own].sort());
        expect(Object.getPrototypeOf(permitted)).toBe(Object.prototype);
      }),
      runs,
    );
  });

  test("never changes Object.prototype, whatever the body's keys", () => {
    fc.assert(
      fc.property(bodies, named, (body, names) => {
        try {
          User.permit(body, ...names);
        } catch {
          // Refused values are covered above.
        }

        const probe = {} as Record<string, unknown>;
        for (const name of [...attributeNames, "isAdmin", "token", "role"]) {
          expect(probe[name]).toBeUndefined();
        }
        expect(Object.keys(Object.prototype)).toEqual([]);
      }),
      runs,
    );
  });

  // A plain object has no inherited keys unless Object.prototype was polluted elsewhere in the
  // app. permit reads own keys only, so even then a name it wasn't given stays out (#82).
  test("reads own keys only, even when Object.prototype carries an attribute's name", () => {
    Object.defineProperty(Object.prototype, "role", {
      value: "admin",
      writable: true,
      enumerable: true,
      configurable: true,
    });
    try {
      expect(User.permit({ email: "ada@example.com" }, "email", "role")).toEqual({
        email: "ada@example.com",
      });
    } finally {
      delete (Object.prototype as Record<string, unknown>).role;
    }
  });

  test("takes a form's or query string's keys, a repeated key taking its last value", () => {
    const pairs = fc.array(fc.tuple(keys, fc.string({ maxLength: 12 })), { maxLength: 8 });

    fc.assert(
      fc.property(pairs, named, (entries, names) => {
        const query = new URLSearchParams(entries);
        let permitted: Record<string, unknown>;
        try {
          permitted = User.permit(query, ...names) as Record<string, unknown>;
        } catch (error) {
          expect(error).toBeInstanceOf(TypeError);
          return;
        }

        expect(Object.keys(permitted).every((key) => names.includes(key as Name))).toBe(true);
        if ("email" in permitted) {
          expect(permitted.email).toBe(query.getAll("email").at(-1));
        }
      }),
      runs,
    );
  });

  test("refuses input that isn't a plain object, FormData or URLSearchParams", () => {
    // Class instances, arrays, maps, dates and objects with another prototype: their keys, and
    // the ones their prototypes carry, are never read.
    const notPlain = fc.oneof(
      fc.anything({ withMap: true, withSet: true, withDate: true, withTypedArray: true }),
      fc.dictionary(fc.constantFrom(...attributeNames), fc.string()).map((own) => {
        return Object.assign(Object.create({ role: "admin", email: "x" }), own) as object;
      }),
    );
    const isPlain = (input: unknown) =>
      typeof input === "object" &&
      input !== null &&
      [Object.prototype, null].includes(Object.getPrototypeOf(input));

    fc.assert(
      fc.property(
        notPlain.filter((input) => !isPlain(input)),
        named,
        (input, names) => {
          expect(() => User.permit(input as never, ...names)).toThrow(TypeError);
        },
      ),
      runs,
    );
  });
});
