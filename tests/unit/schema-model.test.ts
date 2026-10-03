import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import { connect, InvalidModel, modelFor } from "../../src/index.ts";

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
      new InvalidModel('Model("prodcts"): no table named prodcts in this schema'),
    );
    // @ts-expect-error not an attribute of products
    expect(() => Model("products", { nmae: "string" })).toThrow(
      new InvalidModel('Model("products"): products has no attribute nmae to override'),
    );
    // @ts-expect-error the primary key can't be ignored
    expect(() => Model("products", { id: false })).toThrow(
      new InvalidModel('Model("products"): the primary key id can\'t be ignored'),
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
        'Product sets tableName "goods", but its attributes are the products table\'s; name the table in Model("…") instead',
      ),
    );
  });

  test("primaryKey can still be set, and must name an attribute", () => {
    class Product extends Model("products") {
      static override primaryKey = "sku";
    }

    expect(() => db.model(Product)).not.toThrow();
  });
});
