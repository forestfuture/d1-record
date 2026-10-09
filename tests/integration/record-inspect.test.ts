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
});
