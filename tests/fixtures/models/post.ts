// The fixture's Post, a generated Model with a method and a scope (#232).
import { TestRecord } from "./test-record.ts";

export class Post extends TestRecord {
  static titled = this.scope((q, title: string) => q.where({ title }));

  get shout(): string {
    return this.title.toUpperCase();
  }
}
