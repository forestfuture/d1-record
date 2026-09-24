import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { connect, D1RecordError, InvalidModel, Model } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

describe("model declaration", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());

  test("a model without a tableName is rejected when first used", () => {
    class Nameless extends Model({ id: "integer" }) {}

    const use = () => connect(binding).model(Nameless);

    expect(use).toThrow(InvalidModel);
    expect(use).toThrow(/Nameless.*tableName/);
    expect(use).toThrow(D1RecordError);
  });
});
