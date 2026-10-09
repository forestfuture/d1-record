import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { connect, Model } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";
import { drive } from "../support/console.ts";

class Sample extends Model({
  id: { type: "integer", null: false },
  label: "string",
  quantity: "integer",
}) {
  static tableName = "samples";
}

// `d1-record console`: a REPL with the project's Models in scope (#104).
describe("the console session", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.prepare("DELETE FROM samples").run();
    await binding.prepare("INSERT INTO samples (id, label, quantity) VALUES (1, 'bolt', 36)").run();
  });

  test("a Model is in scope, and a result prints after #=>", async () => {
    const console = await drive({ scope: { Sample, db: connect(binding) } });

    expect(await console.send("Sample.tableName")).toBe("#=> 'samples'");
    await console.close();
  });

  test("await works at the top level, and a record prints as it does in a log", async () => {
    const console = await drive({ scope: { Sample, db: connect(binding) } });

    expect(await console.send("await db.model(Sample).find(1)")).toBe(
      "#=> Sample { id: 1, label: 'bolt', quantity: 36 }",
    );
    await console.close();
  });
});
