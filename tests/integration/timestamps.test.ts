import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { connect, Model, type QueryEvent } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

class ApiKey extends Model({
  id: { type: "string", null: false },
  label: { type: "string", null: false },
  createdAt: "datetime",
  updatedAt: "datetime",
}) {
  static tableName = "api_keys";
}

const past = new Date(Date.UTC(2020, 0, 1));

describe("timestamps", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.prepare("DELETE FROM api_keys").run();
  });

  test("creating a record sets createdAt and updatedAt to now", async () => {
    const before = Date.now();
    const key = await connect(binding).model(ApiKey).create({ id: "k1", label: "deploy" });
    const after = Date.now();

    expect(key.createdAt?.getTime()).toBeGreaterThanOrEqual(before);
    expect(key.createdAt?.getTime()).toBeLessThanOrEqual(after);
    expect(key.updatedAt).toEqual(key.createdAt);
  });

  test("explicit timestamps on create are kept", async () => {
    const key = await connect(binding)
      .model(ApiKey)
      .create({ id: "k1", label: "deploy", createdAt: past, updatedAt: past });

    const stored = await connect(binding).model(ApiKey).find("k1");

    expect(key.createdAt).toEqual(past);
    expect(stored.updatedAt).toEqual(past);
  });

  test("saving a change moves updatedAt forward and leaves createdAt alone", async () => {
    await connect(binding)
      .model(ApiKey)
      .create({ id: "k1", label: "deploy", createdAt: past, updatedAt: past });
    const key = await connect(binding).model(ApiKey).find("k1");
    const before = Date.now();

    key.label = "release";
    await key.save();

    const stored = await connect(binding).model(ApiKey).find("k1");
    expect(stored.updatedAt?.getTime()).toBeGreaterThanOrEqual(before);
    expect(stored.createdAt).toEqual(past);
  });

  test("a clean save doesn't touch updatedAt, and an explicit updatedAt is kept", async () => {
    await connect(binding)
      .model(ApiKey)
      .create({ id: "k1", label: "deploy", createdAt: past, updatedAt: past });
    const queries: QueryEvent[] = [];
    const keys = connect(binding, { onQuery: (event) => queries.push(event) }).model(ApiKey);
    const key = await keys.find("k1");
    queries.length = 0;

    await key.save();
    expect(queries).toHaveLength(0);

    const chosen = new Date(Date.UTC(2024, 5, 1));
    key.label = "release";
    key.updatedAt = chosen;
    await key.save();
    expect((await keys.find("k1")).updatedAt).toEqual(chosen);
  });
});
