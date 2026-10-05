import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { belongsTo, connect, hasMany, hasOne, Model } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

class Sample extends Model({
  id: { type: "integer", null: false },
  label: "string",
  quantity: "integer",
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
});
