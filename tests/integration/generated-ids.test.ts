import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { connect, Model, modelFor } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

class Note extends Model({
  id: { type: "string", null: false, generateId: true },
  body: "string",
}) {}

let issued = 0;
const sequential = () => `id-${++issued}`;

class SequentialBase extends Model.Base {
  static override generateId = sequential;
}

const tables = {
  notes: {
    attributes: { id: { type: "string", null: false, generateId: true }, body: "string" },
    primaryKey: "id",
  },
} as const;

class SequentialNote extends modelFor(tables, SequentialBase)("notes") {}

class PrefixedNote extends Model({
  id: { type: "string", null: false, generateId: true },
  body: "string",
}) {
  static override tableName = "notes";

  static override generateId(attribute: string) {
    return `${attribute}_${super.generateId(attribute)}`;
  }
}

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

  test("a function assigned to the base class's generateId makes every Model's ids", async () => {
    issued = 0;
    const note = await connect(binding).model(SequentialNote).create({ body: "hi" });

    expect(note.id).toBe("id-1");
  });

  test("a Model's own generateId gets the attribute's name", async () => {
    const note = await connect(binding).model(PrefixedNote).create({ body: "hi" });
    const stored = await connect(binding).model(PrefixedNote).find(note.id);

    expect(stored.id).toMatch(/^id_[0-9a-f-]{36}$/);
  });
});
