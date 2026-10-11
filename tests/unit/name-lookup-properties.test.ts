import fc from "fast-check";
import { describe, test } from "vite-plus/test";
import { connect, hasMany, Model, UnknownAssociation, UnknownAttribute } from "../../src/index.ts";

class Post extends Model({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static tableName = "posts";
}

class User extends Model({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static tableName = "users";

  posts = hasMany(Post, { foreignKey: "userId" });
}

// No D1 needed: these calls check their names before they query.
const users = connect({} as never).model(User);
const user = users.build({ id: 1, email: "ada@example.com" });

const own = new Set(["id", "email", "posts"]);

// Names an app might take from a URL (`?include=`, `?sort=`) or a JSON body: every member that
// objects, functions and arrays inherit, and any other text. None is one of the Model's own
// (#84, #122).
const inheritedNames = [
  ...Object.getOwnPropertyNames(Object.prototype),
  ...Object.getOwnPropertyNames(Function.prototype),
  ...Object.getOwnPropertyNames(Array.prototype),
  "prototype",
  "__defineGetter__",
];
const names = fc
  .oneof(fc.constantFrom(...inheritedNames), fc.string({ maxLength: 16 }))
  .filter((name) => !own.has(name));

const runs = { numRuns: 1000 };

/** Whether `call` throws exactly `error`, and not another error or nothing. */
function throwsOnly(error: new (...args: never[]) => Error, call: () => unknown): boolean {
  try {
    call();
  } catch (thrown) {
    return thrown instanceof error;
  }
  return false;
}

describe("a name that isn't the Model's own, of any kind", () => {
  test("is UnknownAssociation where an association is named", () => {
    fc.assert(
      fc.property(names, (name) => {
        const unknown = name as never;
        return (
          throwsOnly(UnknownAssociation, () => users.includes(unknown)) &&
          throwsOnly(UnknownAssociation, () => users.includes({ [name]: "posts" } as never)) &&
          throwsOnly(UnknownAssociation, () => users.includes({ posts: name } as never)) &&
          throwsOnly(UnknownAssociation, () => user.loaded(unknown)) &&
          throwsOnly(UnknownAssociation, () => user.isLoaded(unknown))
        );
      }),
      runs,
    );
  });

  test("is UnknownAttribute where an attribute is named", () => {
    fc.assert(
      fc.property(names, (name) => {
        const unknown = name as never;
        // A JSON body's key, which may be an own "__proto__".
        const keyed = JSON.parse(`{${JSON.stringify(name)}: 1}`) as never;
        return (
          throwsOnly(UnknownAttribute, () => user.attributeWas(unknown)) &&
          throwsOnly(UnknownAttribute, () => user.isAttributeChanged(unknown)) &&
          throwsOnly(UnknownAttribute, () => user.restoreAttributes([unknown])) &&
          throwsOnly(UnknownAttribute, () => users.select(unknown)) &&
          throwsOnly(UnknownAttribute, () => users.order({ [name]: "asc" } as never)) &&
          throwsOnly(UnknownAttribute, () => users.where(keyed)) &&
          throwsOnly(UnknownAttribute, () => users.build(keyed)) &&
          throwsOnly(UnknownAttribute, () => user.assign(keyed)) &&
          throwsOnly(UnknownAttribute, () => User.permit({}, unknown))
        );
      }),
      runs,
    );
  });
});
