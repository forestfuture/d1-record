import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  connect,
  hasMany,
  InvalidModel,
  Model,
  modelFor,
  RecordNotUnique,
} from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

class Note extends Model({
  id: { type: "string", null: false, generateId: true },
  notebookId: "string",
  body: "string",
}) {}

class Notebook extends Model({
  id: { type: "string", null: false, generateId: true },
  title: "string",
}) {
  notes = hasMany(Note);
}

class NumberedNote extends Model({
  id: { type: "string", null: false, generateId: true },
  body: "string",
}) {
  static override tableName = "notes";

  static override generateId = () => 42 as unknown as string;
}

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

const generatedTables = {
  notebooks: {
    attributes: {
      id: { type: "string", null: false, generateId: true },
      title: "string",
      color: { type: "string", default: () => "blue" },
    },
    primaryKey: "id",
  },
} as const;
const ApplicationRecord = modelFor(generatedTables);

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
    await binding.prepare("DELETE FROM notebooks").run();
    issued = 0;
  });

  test("a built record has a UUID before it's saved", () => {
    const note = connect(binding).model(Note).build({ body: "hi" });

    expect(note.id).toMatch(uuid);
  });

  test("a function assigned to the base class's generateId makes every Model's ids", async () => {
    const note = await connect(binding).model(SequentialNote).create({ body: "hi" });

    expect(note.id).toBe("id-1");
  });

  test("a Model's own generateId gets the attribute's name", async () => {
    const note = await connect(binding).model(PrefixedNote).create({ body: "hi" });
    const stored = await connect(binding).model(PrefixedNote).find(note.id);

    expect(stored.id).toMatch(/^id_[0-9a-f-]{36}$/);
  });

  test("a bulk insert generates ids for the rows that leave them out", async () => {
    await connect(binding)
      .model(Note)
      .insertAll([{ body: "a" }, { body: "b" }]);

    const ids = await connect(binding).model(Note).pluck("id");
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(id).toMatch(uuid);
    expect(new Set(ids).size).toBe(2);
  });

  test("a given id is kept", async () => {
    const note = await connect(binding).model(Note).create({ id: "mine", body: "hi" });

    expect(note.id).toBe("mine");
  });

  test("a generateId that returns something other than a string throws TypeError", () => {
    expect(() => connect(binding).model(NumberedNote).build({ body: "hi" })).toThrow(TypeError);
  });

  test("an owner and the records built through it are written in one batch, atomically", async () => {
    await binding.prepare("INSERT INTO notes (id, body) VALUES ('taken', 'x')").run();
    const notebook = connect(binding).model(Notebook).build({ title: "Ideas" });
    notebook.notes().build({ body: "first" });
    notebook.notes().build({ id: "taken", body: "clash" });

    await expect(notebook.save()).rejects.toThrow(RecordNotUnique);

    expect(await connect(binding).model(Notebook).count()).toBe(0);
    expect(await connect(binding).model(Note).pluck("id")).toEqual(["taken"]);
  });

  describe("declaring one", () => {
    test("with a default too is an InvalidModel", () => {
      class Both extends Model({
        // @ts-expect-error a compile error too; this checks plain JavaScript
        id: { type: "string", null: false, generateId: true, default: () => "x" },
      }) {
        static override tableName = "notes";
      }

      expect(() => connect(binding).model(Both)).toThrow(
        new InvalidModel("Both.id has both generateId and a default; keep one"),
      );
    });

    test("on an attribute that isn't a string is an InvalidModel", () => {
      class Counted extends Model({
        // @ts-expect-error a compile error too; this checks plain JavaScript
        id: { type: "integer", null: false, generateId: true },
      }) {
        static override tableName = "notes";
      }

      expect(() => connect(binding).model(Counted)).toThrow(
        new InvalidModel(
          'Counted.id is "integer", so it can\'t have generateId: generated ids are strings',
        ),
      );
    });
  });

  describe('overriding one in ApplicationRecord("table", {...})', () => {
    test("a default replaces generateId", () => {
      class Given extends ApplicationRecord("notebooks", { id: { default: () => "fixed" } }) {}

      expect(connect(binding).model(Given).build().id).toBe("fixed");
    });

    test("generateId: false turns it off", () => {
      class Plain extends ApplicationRecord("notebooks", { id: { generateId: false } }) {}

      expect(connect(binding).model(Plain).build().id).toBeNull();
    });

    test("changing the type drops it", () => {
      class Retyped extends ApplicationRecord("notebooks", { id: "integer" }) {}

      expect(connect(binding).model(Retyped).build().id).toBeNull();
    });

    test("generateId: true turns it on for a string attribute", () => {
      class Titled extends ApplicationRecord("notebooks", { title: { generateId: true } }) {}

      expect(connect(binding).model(Titled).build().title).toMatch(uuid);
    });

    test("generateId: false leaves a default alone", () => {
      class Colored extends ApplicationRecord("notebooks", { color: { generateId: false } }) {}

      expect(connect(binding).model(Colored).build().color).toBe("blue");
    });

    test("a bad one is an InvalidModel when called", () => {
      expect(() =>
        // @ts-expect-error a compile error too; this checks plain JavaScript
        ApplicationRecord("notebooks", { id: { generateId: true, default: () => "x" } }),
      ).toThrow(new InvalidModel("notebooks.id has both generateId and a default; keep one"));
      expect(() =>
        // @ts-expect-error a compile error too; this checks plain JavaScript
        ApplicationRecord("notebooks", { id: { type: "integer", generateId: true } }),
      ).toThrow(
        new InvalidModel(
          'notebooks.id is "integer", so it can\'t have generateId: generated ids are strings',
        ),
      );
    });
  });
});
