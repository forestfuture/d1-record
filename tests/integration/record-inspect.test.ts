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

class User extends Model({
  id: { type: "integer", null: false },
  email: { type: "string", null: false }, // filtered by default: "email"
  role: "string",
}) {
  static tableName = "users";
}

class Hider extends Model({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
}) {
  static tableName = "users";
  static override filterAttributes = [];
  static hiddenAttributes = ["email"];
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
    await binding.prepare("DELETE FROM users").run();
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

  describe("a filtered attribute", () => {
    const row = { id: 1, email: "ada@example.com", role: null };

    test("prints as [FILTERED], unquoted so it isn't mistaken for a string", async () => {
      const user = await connect(binding).model(User).create(row);

      expect(inspect(user)).toBe("User { id: 1, email: [FILTERED], role: null }");
    });

    test("is highlighted as a special value when colors are on", async () => {
      const user = await connect(binding).model(User).create(row);

      expect(inspect(user, { colors: true })).toContain("email: \u001b[36m[FILTERED]\u001b[39m");
    });

    test("prints null when it has no value, as there is nothing to hide", () => {
      const user = connect(binding).model(User).build({});

      expect(inspect(user)).toBe("User { id: null, email: null, role: null }");
    });
  });

  test("a hidden attribute is still shown: hiding is for serializing, not for logs", async () => {
    const hider = await connect(binding)
      .model(Hider)
      .create({ id: 1, email: "ada@example.com", role: "admin" });

    expect(inspect(hider)).toBe("Hider { id: 1, email: 'ada@example.com', role: 'admin' }");
  });

  test("a record in an array or object prints in place, and depth is respected", async () => {
    const sample = await connect(binding).model(Sample).create({ id: 1, label: "bolt" });

    expect(inspect([sample])).toBe("[ Sample { id: 1, label: 'bolt', quantity: null } ]");
    expect(inspect({ sample }, { depth: 0 })).toBe("{ sample: [Sample] }");
    expect(inspect({ sample }, { depth: 1 })).toContain("sample: Sample { id: 1,");
  });

  describe("an unsaved change", () => {
    test("is flagged with the value it had", async () => {
      const sample = await connect(binding)
        .model(Sample)
        .create({ id: 1, label: "bolt", quantity: 36 });
      sample.label = "nut";

      expect(inspect(sample)).toBe("Sample { id: 1, label: 'nut' (was 'bolt'), quantity: 36 }");
    });

    test("is not flagged once saved", async () => {
      const sample = await connect(binding)
        .model(Sample)
        .create({ id: 1, label: "bolt", quantity: 36 });
      await sample.update({ label: "nut" });

      expect(inspect(sample)).toBe("Sample { id: 1, label: 'nut', quantity: 36 }");
    });

    test("is not flagged on a new record, where everything is unsaved", () => {
      const sample = connect(binding).model(Sample).build({ label: "bolt" });

      expect(inspect(sample)).toBe("Sample { id: null, label: 'bolt', quantity: null }");
    });

    test("in a filtered attribute says only that it changed", async () => {
      const user = await connect(binding)
        .model(User)
        .create({ id: 1, email: "ada@example.com", role: "admin" });
      user.email = "grace@example.com";

      expect(inspect(user)).toBe("User { id: 1, email: [FILTERED] (changed), role: 'admin' }");
    });
  });
});
