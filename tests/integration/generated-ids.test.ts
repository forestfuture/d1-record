import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { connect, Model } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

class Note extends Model({
  id: { type: "string", null: false, generateId: true },
  body: "string",
}) {}

describe("generated ids", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase(
      new URL("../fixtures/generated-ids.sql", import.meta.url),
    ));
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.prepare("DELETE FROM notes").run();
  });

  test("a built record has a UUID before it's saved", () => {
    const note = connect(binding).model(Note).build({ body: "hi" });

    expect(note.id).toMatch(uuid);
  });
});
