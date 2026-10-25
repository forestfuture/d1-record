/* oxlint-disable typescript/no-unsafe-declaration-merging -- each interface stands in for the
   declarations d1-record schema generates, which merge from another file: the accessors they
   type are defined when the Model's attributes resolve. */
import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import { connect, InvalidModel, Model, sql, type TableAttributes } from "../../src/index.ts";

const db = connect({} as never);

// A generated schema, as `d1-record schema` writes it.
const products = {
  id: { type: "string", null: false, default: () => "key" },
  name: { type: "string", null: false },
  flags: "integer",
  sku: "string",
  notes: "string",
} as const;
const events = { eventId: { type: "integer", null: false }, at: "datetime" } as const;
const entries = {
  id: { type: "integer", null: false },
  at: { type: "datetime", storage: "unixSeconds" },
} as const;
const schema = {
  binding: "DB",
  tables: {
    products: { attributes: products, primaryKey: "id" },
    events: { attributes: events, primaryKey: "eventId" },
    entries: { attributes: entries, primaryKey: "id" },
  },
  models: {
    Product: "products",
    Event: "events",
    Retyped: "products",
    Ignoring: "products",
    Dated: "products",
    Entry: "entries",
    RetypedEntry: "entries",
    Strange: "products",
    Keyed: "products",
    Unknown: "products",
    Unset: "products",
  },
} as const;

/** An app's base class, as Rails' ApplicationRecord, with a method, a static and a scope. */
abstract class AppRecord extends Model {
  static override schema = schema;

  label() {
    return `${this.constructor.name} ${JSON.stringify(this.attributes())}`;
  }

  static describe() {
    return `${this.name} on ${this.table}`;
  }

  static newest = this.scope((q) => q.order(sql`created_at DESC`));
}

class Product extends AppRecord {
  static cheap = this.scope((q) => q.where(sql`flags = 0`));
}
interface Product extends TableAttributes<typeof products, (typeof Product)["attributes"]> {}

class Event extends AppRecord {}
interface Event extends TableAttributes<typeof events, (typeof Event)["attributes"]> {}

class Retyped extends AppRecord {
  static override table = "products";
  static override attributes = {
    flags: "boolean",
    sku: { null: false, default: () => "SKU-1" },
    name: { null: true },
  } as const;
}
interface Retyped extends TableAttributes<typeof products, (typeof Retyped)["attributes"]> {}

class Ignoring extends AppRecord {
  static override table = "products";
  static override attributes = { notes: false } as const;
}
interface Ignoring extends TableAttributes<typeof products, (typeof Ignoring)["attributes"]> {}

class Dated extends AppRecord {
  static override table = "products";
  static override attributes = {
    flags: { type: "datetime", storage: "unixSeconds", null: false },
  } as const;
}
interface Dated extends TableAttributes<typeof products, (typeof Dated)["attributes"]> {}

describe("a generated Model", () => {
  test("has its table's attributes and primary key, from the schema", () => {
    expect([Product.table, Product.primaryKey]).toEqual(["products", "id"]);
    expect([Event.table, Event.primaryKey]).toEqual(["events", "eventId"]);
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

  test("a subclass, or an anonymous one, shares its parent's table", () => {
    const Anonymous = class extends Product {};
    class Special extends Product {}

    expect([Anonymous.table, Special.table]).toEqual(["products", "products"]);
    expect(() => db.model(Anonymous)).not.toThrow();
  });

  test("has its base class's methods, statics and scopes, typed, beside its own", () => {
    expect(db.model(Product).build({ name: "Lamp" }).label()).toMatch(
      /^Product \{"id":"key","name":"Lamp"/,
    );
    expect(Product.describe()).toBe("Product on products");
    expectTypeOf<Product["label"]>().toEqualTypeOf<() => string>();
    expect([typeof Product.newest, typeof Product.cheap]).toEqual(["function", "function"]);
    expectTypeOf(db.model(Product).cheap().newest).toBeFunction();
    expectTypeOf(db.model(Event).newest).toBeFunction();
    // @ts-expect-error another Model's own scope isn't inherited
    void db.model(Event).cheap;
  });

  test("once it's used, its base class's declarations are fixed too, as its own are", () => {
    abstract class Sealed extends Model {
      static override schema = schema;
    }
    class Product extends Sealed {}
    db.model(Product);

    expect(() => Sealed.beforeSave(() => {})).toThrow(
      new InvalidModel(
        "Sealed has already been used; declare validations, callbacks and messages in its static {} block",
      ),
    );
  });
});

describe("a generated Model's static attributes", () => {
  test("change type, null and default; a type name alone changes the type", () => {
    expect(Retyped.attributeDefinitions.get("flags")).toMatchObject({
      type: "boolean",
      column: "flags",
    });
    expect(db.model(Retyped).build().sku).toBe("SKU-1");
    expectTypeOf<Retyped["flags"]>().toEqualTypeOf<boolean | null>();
    expectTypeOf<Retyped["sku"]>().toEqualTypeOf<string>();
    expectTypeOf<Retyped["name"]>().toEqualTypeOf<string | null>();
    expectTypeOf<Retyped["id"]>().toEqualTypeOf<string>();
  });

  test("false ignores a column: no attribute, so it's never read or written", () => {
    expect(Ignoring.attributeDefinitions.has("notes")).toBe(false);
    // @ts-expect-error an ignored column isn't an attribute
    expectTypeOf<Ignoring["notes"]>();
    expect(() => db.model(Ignoring).build({ notes: "x" } as never)).toThrow(
      'Ignoring has no attribute "notes"',
    );
  });

  test("an override of an attribute its table doesn't have is an InvalidModel", () => {
    class Strange extends AppRecord {
      static override table = "products";
      static override attributes = { nmae: "string" } as const;
    }

    expect(() => db.model(Strange).build()).toThrow(
      new InvalidModel("Strange has no attribute nmae to override"),
    );
  });

  test("ignoring the primary key is an InvalidModel; overriding a column is a type error", () => {
    class Keyed extends AppRecord {
      static override table = "products";
      static override attributes = { id: false } as const;
    }
    // @ts-expect-error a column comes from the table
    class Strange extends AppRecord {
      static override table = "products";
      static override attributes = { sku: { column: "code" } } as const;
    }

    expect(() => db.model(Keyed).build()).toThrow(
      new InvalidModel("Keyed.id is the primary key, so it can't be ignored"),
    );
    expect(Strange).toBeTypeOf("function");
  });

  test("overrides without as const are a compile error, not a widened type", () => {
    // @ts-expect-error `"boolean"` widens to string, which isn't an attribute type.
    class Strange extends AppRecord {
      static override attributes = { notes: "boolean" };
    }
    // @ts-expect-error `false` widens to boolean.
    class Draft extends AppRecord {
      static override attributes = { notes: false };
    }

    expect([Strange, Draft]).toHaveLength(2);
  });

  test("an override left undefined changes nothing, so a generated default stays", () => {
    class Unset extends AppRecord {
      static override table = "products";
      static override attributes = { id: { default: undefined }, sku: undefined } as never;
    }

    expect((db.model(Unset).build() as unknown as Product).id).toBe("key");
  });

  test("make a column a datetime with a storage (#73)", () => {
    expect(Dated.attributeDefinitions.get("flags")).toMatchObject({
      type: "datetime",
      storage: "unixSeconds",
    });
    expectTypeOf<Dated["flags"]>().toEqualTypeOf<Date>();
  });

  test("a new type drops a generated storage, which was for a datetime (#73)", () => {
    class Entry extends AppRecord {}
    class RetypedEntry extends AppRecord {
      static override table = "entries";
      static override attributes = { at: "integer" } as const;
    }

    expect(Entry.attributeDefinitions.get("at")).toMatchObject({ storage: "unixSeconds" });
    expect(RetypedEntry.attributeDefinitions.get("at")).toEqual(
      expect.not.objectContaining({ storage: expect.anything() }),
    );
  });

  test("a storage on a non-datetime, or an unknown storage, is a type error and an InvalidModel (#73)", () => {
    const withFlags = (flags: unknown) =>
      class Strange extends AppRecord {
        static override table = "products";
        static override attributes = { flags } as never;
      };
    // @ts-expect-error a storage is for a datetime
    class Integer extends AppRecord {
      static override attributes = { flags: { type: "integer", storage: "unixSeconds" } } as const;
    }
    // @ts-expect-error a storage is seconds or milliseconds
    class Minutes extends AppRecord {
      static override attributes = { flags: { type: "datetime", storage: "minutes" } } as const;
    }

    expect(() => db.model(withFlags({ type: "integer", storage: "unixSeconds" })).build()).toThrow(
      new InvalidModel(
        'Strange.flags is "integer", so it can\'t have a storage: only a datetime is stored as an epoch',
      ),
    );
    expect(() => db.model(withFlags({ type: "datetime", storage: "minutes" })).build()).toThrow(
      InvalidModel,
    );
    expect([Integer, Minutes]).toHaveLength(2);
  });

  test("an override past the types is checked too: the column, or anything but a spec, is an InvalidModel", () => {
    const withSku = (sku: unknown) =>
      class Strange extends AppRecord {
        static override table = "products";
        static override attributes = { sku } as never;
      };
    const message = new InvalidModel(
      "Strange.sku: an override is a type name, { type, null, default, generateId, storage }, or false",
    );

    for (const sku of [{ column: "code" }, "money", true, { default: "SKU" }, { null: "no" }]) {
      expect(() => db.model(withSku(sku)).build()).toThrow(message);
    }
  });
});

describe("a generated Model's primary key", () => {
  test("can still be set, and must name an attribute that isn't ignored", () => {
    class Keyed extends AppRecord {
      static override table = "products";
      static override primaryKey = "sku";
    }
    class Unknown extends AppRecord {
      static override table = "products";
      static override primaryKey = "code";
    }
    class Ignoring extends AppRecord {
      static override table = "products";
      static override attributes = { sku: false } as const;
      static override primaryKey = "sku";
    }

    expect(() => db.model(Keyed)).not.toThrow();
    expect(() => db.model(Unknown)).toThrow(InvalidModel);
    expect(() => db.model(Ignoring)).toThrow(/primaryKey "sku" isn't a declared attribute/);
  });
});

describe("a generated Model's subclass", () => {
  test("naming another table is an InvalidModel: its attributes are its parent's table's", () => {
    class Renamed extends Product {
      static override table = "drafts";
    }

    expect(() => db.model(Renamed).build()).toThrow(
      new InvalidModel(
        "Renamed sets table \"drafts\", but its attributes are the products table's, as Product's are; " +
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

describe("a Model the schema wasn't generated for", () => {
  test("is an InvalidModel when used, saying to run d1-record schema", () => {
    class Ungenerated extends AppRecord {}

    expect(() => db.model(Ungenerated).build()).toThrow(
      new InvalidModel("Ungenerated isn't in the generated schema; run d1-record schema"),
    );
  });

  test("whose table changed since is an InvalidModel, saying to run d1-record schema", () => {
    class Product extends AppRecord {
      static override table = "drafts";
    }

    expect(() => db.model(Product).build()).toThrow(
      new InvalidModel(
        "Product's table is drafts, but the generated schema has products; run d1-record schema",
      ),
    );
  });

  test("has statics that are a compile error, as an abstract base class's are", () => {
    class Ungenerated extends AppRecord {}
    const use = () => {
      // @ts-expect-error Its records have no attributes until d1-record schema runs.
      void Ungenerated.find(1);
      // @ts-expect-error Its records have no attributes until d1-record schema runs.
      void Ungenerated.where({});
      // @ts-expect-error An abstract class has no table to query.
      void AppRecord.all();
    };

    expect(use).toBeTypeOf("function");
  });
});

describe("define on the app's base class", () => {
  test("declares a Model's attributes by hand, with the base class's methods", () => {
    class Visit extends AppRecord.define({ id: "integer", path: "string" }) {}

    expect([Visit.table, Visit.primaryKey]).toEqual(["visits", "id"]);
    expect(db.model(Visit).build().label()).toBe('Visit {"id":null,"path":null}');
    expectTypeOf<Visit["path"]>().toEqualTypeOf<string | null>();
    expectTypeOf<Visit["label"]>().toEqualTypeOf<() => string>();
  });
});
