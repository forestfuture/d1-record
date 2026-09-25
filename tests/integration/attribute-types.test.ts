import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { connect, Model, sql } from "../../src/index.ts";
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

describe("attribute types", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.prepare("DELETE FROM samples").run();
  });

  test("each type reads back from D1 as its JavaScript value", async () => {
    await binding
      .prepare(
        `INSERT INTO samples (id, label, quantity, ratio, enabled, stamp, settings)
         VALUES (1, 'hello', 42, 0.5, 1, '2026-01-02T03:04:05.000Z', '{"theme":"dark","sizes":[1,2]}')`,
      )
      .run();

    const [sample] = await connect(binding).model(Sample).toArray();

    expect(sample?.label).toBe("hello");
    expect(sample?.quantity).toBe(42);
    expect(sample?.ratio).toBe(0.5);
    expect(sample?.enabled).toBe(true);
    expect(sample?.stamp).toEqual(new Date(Date.UTC(2026, 0, 2, 3, 4, 5)));
    expect(sample?.settings).toEqual({ theme: "dark", sizes: [1, 2] });
  });

  test("NULL reads back as null for every type", async () => {
    await binding.prepare("INSERT INTO samples (id) VALUES (1)").run();

    const [sample] = await connect(binding).model(Sample).toArray();

    expect([
      sample?.label,
      sample?.quantity,
      sample?.ratio,
      sample?.enabled,
      sample?.stamp,
      sample?.settings,
    ]).toEqual([null, null, null, null, null, null]);
  });

  test("where converts values to their stored form", async () => {
    await binding
      .prepare(
        `INSERT INTO samples (id, enabled, stamp) VALUES
           (1, 1, '2026-01-02T03:04:05.000Z'),
           (2, 0, '2026-06-07T08:09:10.000Z')`,
      )
      .run();
    const samples = connect(binding).model(Sample);

    const enabled = await samples.where({ enabled: true }).toArray();
    const stamped = await samples
      .where({ stamp: new Date(Date.UTC(2026, 5, 7, 8, 9, 10)) })
      .toArray();

    expect(enabled.map((sample) => sample.id)).toEqual([1]);
    expect(stamped.map((sample) => sample.id)).toEqual([2]);
  });

  test("where with null matches rows whose column is NULL", async () => {
    await binding.prepare("INSERT INTO samples (id, label) VALUES (1, 'set'), (2, NULL)").run();

    const unlabeled = await connect(binding).model(Sample).where({ label: null }).toArray();

    expect(unlabeled.map((sample) => sample.id)).toEqual([2]);
  });

  test("booleans and dates interpolated into an sql fragment are bound in their stored form", async () => {
    await binding
      .prepare(
        `INSERT INTO samples (id, enabled, stamp) VALUES
           (1, 1, '2026-01-02T03:04:05.000Z'),
           (2, 0, '2026-01-02T03:04:05.000Z')`,
      )
      .run();
    const stamp = new Date(Date.UTC(2026, 0, 2, 3, 4, 5));

    const samples = await connect(binding)
      .model(Sample)
      .where(sql`enabled = ${true} AND stamp = ${stamp}`)
      .toArray();

    expect(samples.map((sample) => sample.id)).toEqual([1]);
  });

  test("toJSON gives the attributes with dates as ISO strings, so Response.json works", async () => {
    await binding
      .prepare(
        `INSERT INTO samples (id, label, enabled, stamp, settings)
         VALUES (1, 'hello', 1, '2026-01-02T03:04:05.000Z', '{"theme":"dark"}')`,
      )
      .run();
    const samples = connect(binding).model(Sample);
    const [sample] = await samples.toArray();
    const [partial] = await samples.select("stamp").toArray();

    expect(JSON.parse(JSON.stringify(sample))).toEqual({
      id: 1,
      label: "hello",
      quantity: null,
      ratio: null,
      enabled: true,
      stamp: "2026-01-02T03:04:05.000Z",
      settings: { theme: "dark" },
    });
    expect(await Response.json(partial).json()).toEqual({
      id: 1,
      stamp: "2026-01-02T03:04:05.000Z",
    });
  });
});
