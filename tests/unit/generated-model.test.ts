import { describe, expect, test } from "vite-plus/test";
import { connect, InvalidModel, Model } from "../../src/index.ts";

const db = connect({} as never);

// A generated schema of one table, and an app's base class holding it.
const schema = {
  binding: "DB",
  tables: {
    posts: {
      attributes: { id: { type: "integer", null: false }, title: "string", notes: "string" },
      primaryKey: "id",
    },
  },
  models: { Post: "posts" },
} as const;

abstract class AppRecord extends Model {
  static override schema = schema;
}

describe("a generated Model's static attributes", () => {
  test("an override of an attribute its table doesn't have is an InvalidModel", () => {
    class Post extends AppRecord {
      static override attributes = { titel: "string" } as const;
    }

    expect(() => db.model(Post).build()).toThrow(
      new InvalidModel("Post has no attribute titel to override"),
    );
  });

  test("overrides without as const are a compile error, not a widened type", () => {
    // @ts-expect-error `"boolean"` widens to string, which isn't an attribute type.
    class Post extends AppRecord {
      static override attributes = { notes: "boolean" };
    }
    // @ts-expect-error `false` widens to boolean.
    class Draft extends AppRecord {
      static override attributes = { notes: false };
    }

    expect([Post, Draft]).toHaveLength(2);
  });
});

describe("a generated Model's subclass", () => {
  test("naming another table is an InvalidModel: its attributes are its parent's table's", () => {
    class Post extends AppRecord {}
    class Renamed extends Post {
      static override table = "drafts";
    }

    expect(() => db.model(Renamed).build()).toThrow(
      new InvalidModel(
        "Renamed sets table \"drafts\", but its attributes are the posts table's, as Post's are; " +
          "a subclass shares its parent's table",
      ),
    );
  });
});

describe("abstract classes", () => {
  test("the app's base class, or a class marked abstract, isn't a Model", () => {
    abstract class Shared extends AppRecord {
      static override abstract = true;
    }

    expect(() => db.model(AppRecord as never)).toThrow(
      new InvalidModel(
        "AppRecord is an abstract base class, with no table; use a Model that extends it, such as class Product extends AppRecord {}",
      ),
    );
    expect(() => db.model(Shared as never)).toThrow(
      new InvalidModel(
        "Shared is an abstract base class, with no table; use a Model that extends it, such as class Product extends Shared {}",
      ),
    );
  });
});
