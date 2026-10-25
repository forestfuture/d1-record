// The fixture's Customer, a generated Model whose table isn't named after its class (#232).
import { TestRecord } from "./test-record.ts";

export class Customer extends TestRecord {
  static override table = "accounts";
}
