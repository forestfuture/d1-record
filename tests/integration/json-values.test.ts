import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { connect, hasMany, Model } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

class Doc extends Model({
  id: { type: "integer", null: false },
  folderId: "integer",
  settings: "json",
  secret: "json",
}) {
  static tableName = "json_docs";
  static override filterAttributes = ["secret"];
}

class Folder extends Model({ id: { type: "integer", null: false } }) {
  static tableName = "json_folders";

  docs = hasMany(Doc, { foreignKey: "folderId" });
}

describe("json attributes: values JSON can't write, and cells that aren't JSON (#146)", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
    await binding.batch([
      binding.prepare(
        "CREATE TABLE json_docs (id INTEGER PRIMARY KEY, folder_id INTEGER, settings TEXT, secret TEXT)",
      ),
      binding.prepare("CREATE TABLE json_folders (id INTEGER PRIMARY KEY)"),
    ]);
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.batch([
      binding.prepare("DELETE FROM json_docs"),
      binding.prepare("DELETE FROM json_folders"),
    ]);
  });

  const docs = () => connect(binding).model(Doc);
  const insertCell = (column: string, text: string, id = 1) =>
    binding.prepare(`INSERT INTO json_docs (id, ${column}) VALUES (?, ?)`).bind(id, text).run();

  describe("a bulk write refuses it, where it used to store NULL", () => {
    test("insertAll, writing nothing", async () => {
      await expect(docs().insertAll([{ id: 1, settings: (() => 1) as never }])).rejects.toThrow(
        new TypeError(`Doc: () => 1 isn't a JSON value for "settings"`),
      );
      expect(await docs().count()).toBe(0);
    });

    test("upsertAll", async () => {
      await expect(
        docs().upsertAll([{ id: 1, settings: Symbol("s") as never }], { uniqueBy: "id" }),
      ).rejects.toThrow(new TypeError(`Doc: Symbol(s) isn't a JSON value for "settings"`));
    });

    test("updateAll, leaving the rows as they were", async () => {
      await insertCell("settings", '{"a":1}');

      await expect(docs().updateAll({ settings: 10n as never })).rejects.toThrow(
        new TypeError(`Doc: 10 isn't a JSON value for "settings"`),
      );
      expect((await docs().find(1)).settings).toEqual({ a: 1 });
    });
  });

  describe("a cell that isn't JSON fails when it's read, naming the Model and attribute", () => {
    test("by find", async () => {
      await insertCell("settings", "not json {");

      await expect(docs().find(1)).rejects.toThrow(
        new TypeError(`Doc: "not json {" isn't a JSON value for "settings"`),
      );
    });

    test("by a list, which fails whole", async () => {
      await insertCell("settings", '{"ok":true}', 1);
      await insertCell("settings", "{oops", 2);

      await expect(docs().toArray()).rejects.toThrow(
        new TypeError(`Doc: "{oops" isn't a JSON value for "settings"`),
      );
    });

    test("by reload", async () => {
      await insertCell("settings", '{"ok":true}');
      const doc = await docs().find(1);
      await binding.prepare("UPDATE json_docs SET settings = 'x{' WHERE id = 1").run();

      await expect(doc.reload()).rejects.toThrow(
        new TypeError(`Doc: "x{" isn't a JSON value for "settings"`),
      );
    });

    test("by pluck, as a record load does", async () => {
      await insertCell("settings", "not json {");

      await expect(docs().pluck("settings")).rejects.toThrow(
        new TypeError(`Doc: "not json {" isn't a JSON value for "settings"`),
      );
      await expect(docs().pluck("id", "settings")).rejects.toThrow(TypeError);
    });

    test("a filtered attribute's cell is hidden, by find and by pluck", async () => {
      await insertCell("secret", "not json {");
      const refused = new TypeError(`Doc: [FILTERED] isn't a JSON value for "secret"`);

      await expect(docs().find(1)).rejects.toThrow(refused);
      await expect(docs().pluck("secret")).rejects.toThrow(refused);
    });
  });

  describe("a json value changed in place into one JSON can't write", () => {
    const loaded = async () => {
      await insertCell("settings", '{"a":1}');
      return docs().find(1);
    };

    test("fails the save, naming the attribute", async () => {
      const doc = await loaded();
      (doc.settings as Record<string, unknown>).big = 1n;

      await expect(doc.save()).rejects.toThrow(
        new TypeError(`Doc: [object Object] isn't a JSON value for "settings"`),
      );
    });

    test("fails isChanged and changes, as a cycle does", async () => {
      const doc = await loaded();
      const settings = doc.settings as Record<string, unknown>;
      settings.self = settings;

      expect(() => doc.isChanged()).toThrow(
        new TypeError(`Doc: [object Object] isn't a JSON value for "settings"`),
      );
      expect(() => doc.changes()).toThrow(TypeError);
    });

    test("hides a filtered attribute's value", async () => {
      await insertCell("secret", '{"a":1}');
      const doc = await docs().find(1);
      (doc.secret as Record<string, unknown>).big = 1n;

      await expect(doc.save()).rejects.toThrow(
        new TypeError(`Doc: [FILTERED] isn't a JSON value for "secret"`),
      );
    });

    test("fails a loaded association's pluck, which copies the records' values", async () => {
      await binding.prepare("INSERT INTO json_folders (id) VALUES (1)").run();
      await binding
        .prepare(`INSERT INTO json_docs (id, folder_id, settings) VALUES (1, 1, '{"a":1}')`)
        .run();
      const folder = await connect(binding).model(Folder).find(1);
      const [doc] = await folder.docs().toArray();
      (doc!.settings as Record<string, unknown>).big = 1n;

      await expect(folder.docs().pluck("settings")).rejects.toThrow(
        new TypeError(`Doc: [object Object] isn't a JSON value for "settings"`),
      );
    });
  });

  describe("after a save, the record holds what D1 stored (#163)", () => {
    test("a lossy value is what it was stored as, after an insert", async () => {
      const doc = await docs().create({ id: 1, settings: { n: Number.NaN } });

      expect(doc.settings).toEqual({ n: null });
    });

    test("and after an update", async () => {
      await insertCell("settings", '{"a":1}');
      const doc = await docs().find(1);

      doc.settings = { n: Number.NaN };
      await doc.save();

      expect(doc.settings).toEqual({ n: null });
    });

    test("and the save isn't a change to load again", async () => {
      await insertCell("settings", '{"a":1}');
      const doc = await docs().find(1);
      doc.settings = { n: Number.NaN };
      await doc.save();

      expect(doc.isChanged()).toBe(false);
      expect((await docs().find(1)).settings).toEqual({ n: null });
    });
  });

  describe("a lossy value equal to what is stored (#163)", () => {
    test("holds the stored form after a save of another attribute", async () => {
      await binding.prepare(`INSERT INTO json_docs (id, settings) VALUES (1, '{"n":null}')`).run();
      const doc = await docs().find(1);

      doc.settings = { n: Number.NaN };
      doc.folderId = 2;
      await doc.save();

      expect(doc.settings).toEqual({ n: null });
    });
  });

  describe("a condition with such a value", () => {
    test("matches nothing, not the rows whose cell is NULL", async () => {
      await binding.prepare("INSERT INTO json_docs (id, settings) VALUES (1, NULL)").run();

      const count = await docs()
        .where({ settings: (() => 1) as never })
        .count();

      expect(count).toBe(0);
    });

    test("in a list is dropped, and the rest of the list still matches", async () => {
      await insertCell("settings", '{"a":1}', 1);
      await binding.prepare("INSERT INTO json_docs (id, settings) VALUES (2, NULL)").run();

      const ids = await docs()
        .where({ settings: [(() => 1) as never, null] })
        .pluck("id");

      expect(ids).toEqual([2]);
    });
  });

  describe("is not refused", () => {
    test("plain JSON, nested, with null, a Date, and toJSON", async () => {
      const value = {
        a: [1, { b: null }],
        when: new Date("2026-01-02T03:04:05.000Z"),
        custom: { toJSON: () => "made" },
      };

      await docs().create({ id: 1, settings: value as never });
      const loaded = await docs().find(1);

      expect(loaded.settings).toEqual({
        a: [1, { b: null }],
        when: "2026-01-02T03:04:05.000Z",
        custom: "made",
      });
    });

    test("null is stored as NULL", async () => {
      await docs().create({ id: 1, settings: null });

      expect((await docs().find(1)).settings).toBeNull();
    });

    test("a Map is stored as {}, as JSON writes it", async () => {
      await docs().create({ id: 1, settings: new Map([[1, 2]]) as never });

      expect((await docs().find(1)).settings).toEqual({});
    });

    test("NaN is stored as null, as JSON writes it", async () => {
      await docs().create({ id: 1, settings: { n: Number.NaN } });

      expect((await docs().find(1)).settings).toEqual({ n: null });
    });
  });
});
