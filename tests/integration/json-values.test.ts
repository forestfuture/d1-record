import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { connect, Model } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

class Doc extends Model({
  id: { type: "integer", null: false },
  settings: "json",
  secret: "json",
}) {
  static tableName = "json_docs";
  static override filterAttributes = ["secret"];
}

describe("json attributes: values JSON can't write, and cells that aren't JSON (#146)", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
    await binding
      .prepare("CREATE TABLE json_docs (id INTEGER PRIMARY KEY, settings TEXT, secret TEXT)")
      .run();
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.prepare("DELETE FROM json_docs").run();
  });

  const docs = () => connect(binding).model(Doc);
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  const unwritable: [string, unknown, string][] = [
    ["a BigInt", 10n, "10"],
    ["a cycle", cycle, "[object Object]"],
    ["a function", () => 1, "() => 1"],
    ["a symbol", Symbol("s"), "Symbol(s)"],
  ];

  describe("is refused, naming the Model and attribute", () => {
    test.each(unwritable)("%s, when it's assigned", (_name, value, shown) => {
      expect(() => docs().build({ settings: value as never })).toThrow(
        new TypeError(`Doc: ${shown} isn't a JSON value for "settings"`),
      );
    });

    test("a function in a bulk insert, which used to store NULL", async () => {
      await expect(docs().insertAll([{ id: 1, settings: (() => 1) as never }])).rejects.toThrow(
        TypeError,
      );
      expect(await docs().count()).toBe(0);
    });

    test("a symbol in an upsert", async () => {
      await expect(
        docs().upsertAll([{ id: 1, settings: Symbol("s") as never }], { uniqueBy: "id" }),
      ).rejects.toThrow(TypeError);
    });

    test("a malformed cell, when the record loads", async () => {
      await binding.prepare("INSERT INTO json_docs (id, settings) VALUES (1, 'not json {')").run();

      await expect(docs().find(1)).rejects.toThrow(
        new TypeError(`Doc: "not json {" isn't a JSON value for "settings"`),
      );
    });

    test("a malformed cell fails the list it's in", async () => {
      await binding.batch([
        binding.prepare(`INSERT INTO json_docs (id, settings) VALUES (1, '{"ok":true}')`),
        binding.prepare("INSERT INTO json_docs (id, settings) VALUES (2, '{oops')"),
      ]);

      await expect(docs().toArray()).rejects.toThrow(TypeError);
    });

    test("a malformed cell of a filtered attribute, with its value hidden", async () => {
      await binding.prepare("INSERT INTO json_docs (id, secret) VALUES (1, 'not json {')").run();

      await expect(docs().find(1)).rejects.toThrow(
        new TypeError(`Doc: [FILTERED] isn't a JSON value for "secret"`),
      );
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

    test("null stays NULL", async () => {
      await docs().create({ id: 1, settings: null });

      expect((await docs().find(1)).settings).toBeNull();
    });

    test("a Map, which JSON writes as {}, as it always did", async () => {
      await docs().create({ id: 1, settings: new Map([[1, 2]]) as never });

      expect((await docs().find(1)).settings).toEqual({});
    });
  });
});
