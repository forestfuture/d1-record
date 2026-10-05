import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { belongsTo, connect, hasMany, hasOne, Model } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

class Sample extends Model({
  id: { type: "integer", null: false },
  label: "string",
  quantity: "integer",
  ratio: "real",
  enabled: "boolean",
  stamp: "datetime",
  settings: "json",
}) {
  static tableName = "samples";
}

// A text foreign key (label) pointing at an integer key: the two keys' types differ.
class Note extends Model({ id: { type: "integer", null: false }, label: "string" }) {
  static tableName = "samples";

  owner = belongsTo(Owner, { foreignKey: "label" });
}

class Owner extends Model({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static tableName = "users";

  notes = hasMany(Note, { foreignKey: "label" });
  note = hasOne(Note, { foreignKey: "label" });
}

// An integer foreign key (quantity) pointing at a text key.
class Code extends Model({ id: { type: "string", null: false }, label: "string" }) {
  static tableName = "api_keys";

  counted = hasMany(Counted, { foreignKey: "quantity" });
}

class Counted extends Model({ id: { type: "integer", null: false }, quantity: "integer" }) {
  static tableName = "samples";

  code = belongsTo(Code, { foreignKey: "quantity" });
}

// Values a record inherits from a condition, and keys copied from another record, are cast as
// the condition or key they came from, not as values a request assigns (#94).
describe("values by their use", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  const db = () => connect(binding);

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.batch([
      binding.prepare("DELETE FROM samples"),
      binding.prepare("DELETE FROM users"),
      binding.prepare("DELETE FROM api_keys"),
    ]);
  });

  describe("inherited from a condition", () => {
    test("a record takes the value the condition matched", async () => {
      const sevens = db()
        .model(Sample)
        .where({ label: 7 as never });

      expect(sevens.build({ id: 1 }).label).toBe("7");
      expect((await sevens.create({ id: 2 })).label).toBe("7");
      await sevens.insert({ id: 3 });
      expect(await sevens.order({ id: "asc" }).pluck("id")).toEqual([2, 3]);
    });

    test("a value both rules accept is cast the same either way", () => {
      const five = db()
        .model(Sample)
        .where({ quantity: " 5 " as never });

      expect(five.build({ id: 1 }).quantity).toBe(5);
    });
  });

  describe("a key copied from another record", () => {
    test("a hasMany build writes an integer key into a text foreign key as its digits", async () => {
      const owner = await db().model(Owner).create({ id: 9, email: "ada@example.com" });

      const note = owner.notes().build({ id: 1 });
      await note.save();

      expect(note.label).toBe("9");
      expect(await owner.notes().pluck("id")).toEqual([1]);
    });

    test("so do a hasOne build and a belongsTo set", async () => {
      const owner = await db().model(Owner).create({ id: 9, email: "ada@example.com" });

      expect(owner.note.build({ id: 1 }).label).toBe("9");

      const note = db().model(Note).build({ id: 2 });
      note.owner.set(owner);
      expect(note.label).toBe("9");
    });

    test("and a key D1 generates, filled in when the owner is saved with its records", async () => {
      const owner = db().model(Owner).build({ email: "grace@example.com" });
      const note = owner.notes().build({ id: 3 });

      await owner.save();

      expect(note.label).toBe(String(owner.id));
    });

    test("a key that can't be cast is a TypeError naming the association", () => {
      const counted = db().model(Counted).build({ id: 1 });

      expect(() => counted.code.set(db().model(Code).build({ id: "abc" }))).toThrow(
        new TypeError('Counted: "abc" isn\'t an integer for "quantity", the key of code'),
      );
    });
  });

  describe("preloading across key types", () => {
    test("includes finds the records an integer key and a text foreign key link", async () => {
      await db().model(Owner).insert({ id: 9, email: "ada@example.com" });
      await db().model(Note).insert({ id: 1, label: "9" });

      const [owner] = await db().model(Owner).includes("notes").toArray();
      const [note] = await db().model(Note).includes("owner").toArray();

      expect(owner!.loaded("notes").map((each) => each.id)).toEqual([1]);
      expect(note!.loaded("owner")?.id).toBe(9);
    });
  });

  describe("through an association's own Relation", () => {
    test("insert, upsert and insertAll inherit the owner's key as the foreign key holds it", async () => {
      const owner = await db().model(Owner).create({ id: 9, email: "ada@example.com" });

      await owner.notes().insert({ id: 1 });
      await owner.notes().upsert({ id: 2 }, { uniqueBy: "id" });
      await owner.notes().insertAll([{ id: 3 }]);

      expect(await db().model(Note).order({ id: "asc" }).pluck("label")).toEqual(["9", "9", "9"]);
    });

    test("a key that can't be cast names the association", async () => {
      const code = await db().model(Code).create({ id: "abc", label: "x" });

      expect(() => code.counted().build({ id: 1 })).toThrow(
        new TypeError('Counted: "abc" isn\'t an integer for "quantity", the key of counted'),
      );
    });
  });

  // Every type through the two uses #94 added: inherited from a condition, and a raw value in a
  // bulk write, which the compiler casts itself.
  describe("every type, by use", () => {
    const at = new Date("2026-01-02T00:00:00.000Z");
    const cases = [
      ["label", 7, "7"],
      ["quantity", " 5 ", 5],
      ["ratio", "1.5", 1.5],
      ["enabled", "on", true],
      ["stamp", "2026-01-02", at],
      ["settings", { theme: "dark" }, { theme: "dark" }],
    ] as const;

    test.each(cases)("%s inherits %j from a condition as %j", (attribute, given, expected) => {
      const built = db()
        .model(Sample)
        .where({ [attribute]: given } as never)
        .build({ id: 1 });

      expect(built[attribute]).toEqual(expected);
    });

    test.each(cases.filter(([attribute]) => attribute !== "label"))(
      "a bulk write casts %s's raw %j to %j itself",
      async (attribute, given, expected) => {
        await db()
          .model(Sample)
          .insert({ id: 1, [attribute]: given } as never);

        expect((await db().model(Sample).find(1))[attribute]).toEqual(expected);
      },
    );

    test("a bulk write refuses a value that can't be assigned, before sending anything", () => {
      expect(() =>
        db()
          .model(Sample)
          .toInsert({ id: 1, label: 7 as never }),
      ).toThrow(new TypeError('Sample: 7 isn\'t a string for "label"'));
      expect(() =>
        db()
          .model(Sample)
          .toUpdateAll({ enabled: "no" as never }),
      ).toThrow(TypeError);
    });
  });
});
