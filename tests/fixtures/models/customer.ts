// The fixture's Customer, a generated Model whose table isn't named after its class, and
// which ignores one of its columns (#232).
import { DbRecord } from "./db-record.ts";

export class Customer extends DbRecord {
  static override table = "accounts";
  static override attributes = { personIdentifier: false } as const;
}
