// The fixture's Profile, a generated Model that belongs to a User (#232).
import { belongsTo } from "../../../src/index.ts";
import { TestRecord } from "./test-record.ts";
import { User } from "./user.ts";

export class Profile extends TestRecord {
  user = belongsTo(User);
}
