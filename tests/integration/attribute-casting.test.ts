import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { connect, Model } from "../../src/index.ts";
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

/** Assigns a value no TypeScript type allows, as JSON, a form or a query string can (#81). */
const untyped = (value: unknown) => value as never;

describe("values assigned to attributes are cast to the attribute's type (#81)", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  const samples = () => connect(binding).model(Sample);

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.prepare("DELETE FROM samples").run();
  });

  /** Saves `value` as the attribute, and what it reads as before saving and after reloading. */
  async function roundTrip(attribute: keyof Sample & string, value: unknown) {
    const sample = samples().build({ [attribute]: untyped(value) });
    const assigned = sample[attribute];
    await sample.saveOrThrow();
    const reloaded = await samples().find(sample.id);
    return [assigned, reloaded[attribute]];
  }

  describe("boolean", () => {
    test.each([
      [true, true],
      [false, false],
      [1, true],
      [0, false],
      ["1", true],
      ["0", false],
      ["true", true],
      ["false", false],
      ["TRUE", true],
      ["False", false],
      ["on", true],
      ["off", false],
    ])("%j is %j", async (value, expected) => {
      expect(await roundTrip("enabled", value)).toEqual([expected, expected]);
    });

    test.each([["no"], ["yes"], ["t"], ["f"], [""], [" true"], [2], [-1], [{}], [[]]])(
      "%j is refused",
      (value: unknown) => {
        expect(() => samples().build({ enabled: untyped(value) })).toThrow(
          new TypeError(`Sample: ${JSON.stringify(value)} isn't a boolean for "enabled"`),
        );
      },
    );

    test("a setter casts as it assigns, and refuses without changing the attribute", () => {
      const sample = samples().build({ enabled: true });

      sample.enabled = untyped("false");
      expect(sample.enabled).toBe(false);
      expect(() => (sample.enabled = untyped("no"))).toThrow(TypeError);
      expect(sample.enabled).toBe(false);
    });

    test("assign, update and create cast too", async () => {
      const created = await samples().create({ enabled: untyped("false") });
      expect(created.enabled).toBe(false);

      created.assign({ enabled: untyped("on") });
      expect(created.enabled).toBe(true);

      await created.update({ enabled: untyped("0") });
      expect((await samples().find(created.id)).enabled).toBe(false);
    });

    test("null is still NULL", async () => {
      expect(await roundTrip("enabled", null)).toEqual([null, null]);
    });
  });
});
