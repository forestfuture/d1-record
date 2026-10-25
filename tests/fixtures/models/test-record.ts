// The tests' base class for generated Models, as an app's `ApplicationRecord` (#232).
import { Model } from "../../../src/index.ts";
import { schema } from "../schema.ts";

export abstract class TestRecord extends Model {
  static override schema = schema;
}
