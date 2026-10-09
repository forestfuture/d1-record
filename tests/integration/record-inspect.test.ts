import { inspect } from "node:util";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { connect, Model } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

class Sample extends Model({
  id: { type: "integer", null: false },
  label: "string",
  quantity: "integer",
}) {
  static tableName = "samples";
}

// How a record prints in a console, a log or a test failure (#104).
describe("inspect", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.prepare("DELETE FROM samples").run();
  });

  test("a record prints its class and attributes", async () => {
    const sample = await connect(binding)
      .model(Sample)
      .create({ id: 1, label: "bolt", quantity: 36 });

    expect(inspect(sample)).toBe("Sample { id: 1, label: 'bolt', quantity: 36 }");
  });

  test("a new record prints every attribute, null where none is assigned yet", () => {
    const sample = connect(binding).model(Sample).build({ label: "bolt" });

    expect(inspect(sample)).toBe("Sample { id: null, label: 'bolt', quantity: null }");
  });

  test("a partial record prints only the columns it loaded", async () => {
    await connect(binding).model(Sample).create({ id: 1, label: "bolt", quantity: 36 });
    const [sample] = await connect(binding).model(Sample).select("id", "label").toArray();

    expect(inspect(sample)).toBe("Sample { id: 1, label: 'bolt' }");
  });
});
