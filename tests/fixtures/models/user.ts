// The fixture's User, a generated Model with a hasMany and a hasOne (#232).
import { hasMany, hasOne } from "../../../src/index.ts";
import { Post } from "./post.ts";
import { Profile } from "./profile.ts";
import { TestRecord } from "./test-record.ts";

export class User extends TestRecord {
  posts = hasMany(Post);
  profile = hasOne(Profile);
}
