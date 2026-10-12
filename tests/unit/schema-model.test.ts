import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import { connect, InvalidModel, Model as LibraryModel, modelFor, sql } from "../../src/index.ts";

const db = connect({} as never);

// The shape `d1-record schema` generates (cli/schema/render.ts).
const tables = {
  products: {
    attributes: {
      id: { type: "string", null: false, default: () => "key" },
      name: { type: "string", null: false },
      flags: "integer",
      sku: "string",
      notes: "string",
    },
    primaryKey: "id",
  },
  events: {
    attributes: { eventId: { type: "integer", null: false }, at: "datetime" },
    primaryKey: "eventId",
  },
} as const;

const Model = modelFor(tables);

describe("modelFor: the generated Model", () => {
  test("Model(table) names the table and its primary key, with the table's attributes", () => {
    class Product extends Model("products") {}
    class Event extends Model("events") {}

    expect([Product.tableName, Product.primaryKey]).toEqual(["products", "id"]);
    expect([Event.tableName, Event.primaryKey]).toEqual(["events", "eventId"]);
    expect([...Product.attributeDefinitions.keys()]).toEqual([
      "id",
      "name",
      "flags",
      "sku",
      "notes",
    ]);
    expect(db.model(Product).build().id).toBe("key");
    // @ts-expect-error only the table's attributes are typed
    expectTypeOf<Product["nope"]>();
  });

  test("the table doesn't depend on the class name, so a subclass or an anonymous class shares it", () => {
    const Anonymous = class extends Model("products") {};
    class Special extends class Product extends Model("products") {} {}

    expect([Anonymous.tableName, Special.tableName]).toEqual(["products", "products"]);
    expect(() => db.model(Anonymous)).not.toThrow();
  });

  test("overrides change type, null and default; a type name alone changes the type", () => {
    class Product extends Model("products", {
      flags: "boolean",
      sku: { null: false, default: () => "SKU-1" },
      name: { null: true },
    }) {}

    expect(Product.attributeDefinitions.get("flags")).toMatchObject({
      type: "boolean",
      column: "flags",
    });
    expect(db.model(Product).build().sku).toBe("SKU-1");
    expectTypeOf<Product["flags"]>().toEqualTypeOf<boolean | null>();
    expectTypeOf<Product["sku"]>().toEqualTypeOf<string>();
    expectTypeOf<Product["name"]>().toEqualTypeOf<string | null>();
    expectTypeOf<Product["id"]>().toEqualTypeOf<string>();
  });

  test("false ignores a column: no attribute, so it's never read or written", () => {
    class Product extends Model("products", { notes: false }) {}

    expect(Product.attributeDefinitions.has("notes")).toBe(false);
    // @ts-expect-error an ignored column isn't an attribute
    expectTypeOf<Product["notes"]>();
    expect(() => db.model(Product).build({ notes: "x" } as never)).toThrow(
      'Product has no attribute "notes"',
    );
  });

  test("Model({...}) is the library's Model, unchanged", () => {
    class Visit extends Model({ id: "integer", path: "string" }) {}

    expect([Visit.tableName, Visit.primaryKey]).toEqual(["visits", "id"]);
    expectTypeOf<Visit["path"]>().toEqualTypeOf<string | null>();
  });

  test("a mistyped table or override, or ignoring the primary key, is a type error and an InvalidModel", () => {
    // @ts-expect-error not a table in the schema
    expect(() => Model("prodcts")).toThrow(
      new InvalidModel("There's no table named prodcts in the generated schema"),
    );
    // @ts-expect-error not an attribute of products
    expect(() => Model("products", { nmae: "string" })).toThrow(
      new InvalidModel("products has no attribute nmae to override"),
    );
    // @ts-expect-error the primary key can't be ignored
    expect(() => Model("products", { id: false })).toThrow(
      new InvalidModel("products.id is the primary key, so it can't be ignored"),
    );
    // @ts-expect-error column comes from the table
    void (() => Model("products", { sku: { column: "code" } }));
  });

  test("setting tableName on a generated Model is an InvalidModel: its attributes are that table's", () => {
    class Product extends Model("products") {
      static override tableName = "goods";
    }

    expect(() => db.model(Product)).toThrow(
      new InvalidModel(
        'Product sets tableName "goods", but its attributes are the products table\'s; name the table in its base class\'s call instead (ApplicationRecord("…"))',
      ),
    );
  });

  test("primaryKey can still be set, and must name an attribute", () => {
    class Product extends Model("products") {
      static override primaryKey = "sku";
    }

    expect(() => db.model(Product)).not.toThrow();
  });

  test("an override left undefined changes nothing, so a generated default stays", () => {
    class Product extends Model("products", { id: { default: undefined }, sku: undefined }) {}

    expect(db.model(Product).build().id).toBe("key");
  });

  test("an override makes a column a datetime with a storage (#73)", () => {
    class Product extends Model("products", {
      flags: { type: "datetime", storage: "unixSeconds", null: false },
    }) {}

    expect(Product.attributeDefinitions.get("flags")).toMatchObject({
      type: "datetime",
      storage: "unixSeconds",
    });
    expectTypeOf<Product["flags"]>().toEqualTypeOf<Date>();
    expect(() => {
      // @ts-expect-error a storage is for a datetime
      Model("products", { flags: { type: "integer", storage: "unixSeconds" } });
    }).toThrow(InvalidModel);
    expect(() => {
      // @ts-expect-error a storage is seconds or milliseconds
      Model("products", { flags: { type: "datetime", storage: "minutes" } });
    }).toThrow(InvalidModel);
  });

  test("a new type drops a generated storage, which was for a datetime (#73)", () => {
    const Stored = modelFor({
      entries: {
        attributes: {
          id: { type: "integer", null: false },
          at: { type: "datetime", storage: "unixSeconds" },
        },
        primaryKey: "id",
      },
    } as const);

    class Kept extends Stored("entries") {}
    class Retyped extends Stored("entries", { at: "integer" }) {}

    expect(Kept.attributeDefinitions.get("at")).toMatchObject({ storage: "unixSeconds" });
    expect(Retyped.attributeDefinitions.get("at")).toEqual(
      expect.not.objectContaining({ storage: expect.anything() }),
    );
  });

  test("a storage on a non-datetime, or an unknown storage, is an InvalidModel, past the types too (#73)", () => {
    const flags = (override: unknown) => () => Model("products", { flags: override } as never);

    expect(flags({ type: "integer", storage: "unixSeconds" })).toThrow(
      new InvalidModel(
        'products.flags is "integer", so it can\'t have a storage: only a datetime is stored as an epoch',
      ),
    );
    expect(flags({ type: "datetime", storage: "minutes" })).toThrow(InvalidModel);
    const Plain = LibraryModel({ at: { type: "string", storage: "unixSeconds" } } as never);
    class Note extends (Plain as never as typeof LibraryModel.Base) {}
    expect(() => db.model(Note)).toThrow(InvalidModel);
  });

  test("an override past the types is checked too: the column, or anything but a spec, is an InvalidModel", () => {
    const message = (attribute: string) =>
      new InvalidModel(
        `products.${attribute}: an override is a type name, { type, null, default, generateId, storage }, or false`,
      );

    expect(() => Model("products", { sku: { column: "code" } } as never)).toThrow(message("sku"));
    expect(() => Model("products", { sku: "money" } as never)).toThrow(message("sku"));
    expect(() => Model("products", { sku: true } as never)).toThrow(message("sku"));
    expect(() => Model("products", { sku: { default: "SKU" } } as never)).toThrow(message("sku"));
    expect(() => Model("products", { sku: { null: "no" } } as never)).toThrow(message("sku"));
  });

  test("a primaryKey that isn't an attribute, or is an ignored column, is an InvalidModel", () => {
    class Unknown extends Model("products") {
      static override primaryKey = "code";
    }
    class Ignored extends Model("products", { sku: false }) {
      static override primaryKey = "sku";
    }

    expect(() => db.model(Unknown)).toThrow(InvalidModel);
    expect(() => db.model(Ignored)).toThrow(/primaryKey "sku" isn't a declared attribute/);
  });
});

describe("modelFor(tables, Base): an app's own base class, as Rails' ApplicationRecord", () => {
  class Base extends LibraryModel.Base {
    label() {
      return `${this.constructor.name} ${JSON.stringify(this.attributes())}`;
    }

    static describe() {
      return `${this.name} on ${this.tableName}`;
    }

    static newest = this.scope((q) => q.order(sql`created_at DESC`));
  }
  const ApplicationRecord = modelFor(tables, Base);

  test("every Model built on it has its methods and statics, typed, whichever way it's declared", () => {
    class Product extends ApplicationRecord("products") {}
    class Visit extends ApplicationRecord({ id: "integer", path: "string" }) {}

    expect(db.model(Product).build({ name: "Lamp" }).label()).toMatch(
      /^Product \{"id":"key","name":"Lamp"/,
    );
    expect(db.model(Visit).build().label()).toBe('Visit {"id":null,"path":null}');
    expect(Product.describe()).toBe("Product on products");
    expectTypeOf<Product["label"]>().toEqualTypeOf<() => string>();
    expectTypeOf<Visit["label"]>().toEqualTypeOf<() => string>();
    expect(Object.getPrototypeOf(Object.getPrototypeOf(Product))).toBe(Base);
  });

  test("its scopes add to a Model's own, in types as at runtime", () => {
    class Product extends ApplicationRecord("products") {
      static cheap = this.scope((q) => q.where(sql`flags = 0`));
    }
    class Event extends ApplicationRecord("events") {}

    expect([typeof Product.newest, typeof Product.cheap]).toEqual(["function", "function"]);
    expectTypeOf(db.model(Product).cheap().newest).toBeFunction();
    expectTypeOf(db.model(Event).newest).toBeFunction();
    // @ts-expect-error another Model's own scope isn't inherited
    void db.model(Event).cheap;
  });

  test("once a Model is used, its base class's declarations are fixed too, as its own are", () => {
    class Sealed extends LibraryModel.Base {}
    class Product extends modelFor(tables, Sealed)("products") {}
    db.model(Product);

    expect(() => Sealed.beforeSave(() => {})).toThrow(
      new InvalidModel(
        "Sealed has already been used; declare validations and callbacks in its static {} block",
      ),
    );
  });

  test("the base class is abstract: it has no table, so using it is an InvalidModel, as Rails' abstract_class", () => {
    expect(() => db.model(Base)).toThrow(
      new InvalidModel(
        'Base is an abstract base class, with no table; use a Model built on it, such as class Product extends ApplicationRecord("products") {}',
      ),
    );
  });
});
