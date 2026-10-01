import { describe, expect, test } from "vite-plus/test";
import { belongsTo, connect, hasMany, InvalidModel, Model, NoDatabase } from "../../src/index.ts";

// No D1 needed: these checks happen when a Model is first used.
const db = connect({} as never);

class Post extends Model({ id: "integer", userId: "integer", title: "string" }) {
  static tableName = "posts";
}

describe("association declarations", () => {
  test("an association named like an attribute or a record method is rejected", () => {
    class Shadow extends Model({ id: "integer", posts: "json" }) {
      static tableName = "users";
      posts = hasMany(Post, { foreignKey: "userId" });
    }
    class Clash extends Model({ id: "integer" }) {
      static tableName = "users";
      // A type error too (save is a record method); cast to reach the runtime check.
      save = hasMany(Post, { foreignKey: "userId" }) as never;
    }

    expect(() => db.model(Shadow)).toThrow(/Shadow.*"posts".*attribute/);
    expect(() => db.model(Clash)).toThrow(InvalidModel);
  });

  test("a foreignKey that isn't a declared attribute is rejected", () => {
    class Typo extends Model({ id: "integer" }) {
      static tableName = "users";
      posts = hasMany(Post, { foreignKey: "user_id" });
    }
    class Owner extends Model({ id: "integer" }) {
      static tableName = "posts";
      author = belongsTo(Post, { foreignKey: "authorId" });
    }

    expect(() => db.model(Typo)).toThrow(/Typo.*"posts".*Post.*"user_id"/);
    expect(() => db.model(Owner)).toThrow(/Owner.*"author".*"authorId"/);
  });

  test("a target that isn't a Model is rejected", () => {
    class Lost extends Model({ id: "integer" }) {
      static tableName = "users";
      posts = hasMany("Post" as never, { foreignKey: "userId" }); // a type error too
    }

    expect(() => db.model(Lost)).toThrow(/Lost.*"posts".*Model/);
  });

  test("a record constructed directly has no Database, so its associations throw NoDatabase", () => {
    class User extends Model({ id: "integer" }) {
      posts = hasMany(Post);
    }

    expect(() => new User().posts()).toThrow(NoDatabase);
  });

  test("an inferred key that isn't declared is rejected, saying where it came from", () => {
    class APIKey extends Model({ id: "integer" }) {
      static tableName = "api_keys";
      posts = hasMany(Post); // APIKey → apiKeyId, which Post doesn't declare
    }
    class Draft extends Model({ id: "integer" }) {
      static tableName = "posts";
      writer = belongsTo(Post); // writer → writerId, which Draft doesn't declare
    }
    class BlogPost extends Model({ id: "integer" }) {
      static tableName = "users";
      comments = hasMany(Post); // BlogPost → blogPostId, through underscore
    }

    expect(() => db.model(APIKey)).toThrow(
      /APIKey association "posts": Post has no attribute "apiKeyId" \(inferred from the class name APIKey/,
    );
    expect(() => db.model(Draft)).toThrow(
      /Draft association "writer": Draft has no attribute "writerId" \(inferred from the association name writer/,
    );
    expect(() => db.model(BlogPost)).toThrow(/Post has no attribute "blogPostId"/);
  });

  test("a class renamed by a bundler fails loudly, suggesting foreignKey", () => {
    // What a minifier without keep_names does: the class is now called e.
    const e = class extends Model({ id: "integer" }) {
      static tableName = "users";
      posts = hasMany(Post);
    };

    expect(() => db.model(e)).toThrow(
      /e association "posts": Post has no attribute "eId" \(inferred from the class name e; declare it, or pass foreignKey \(and keep class names/,
    );
  });
});
