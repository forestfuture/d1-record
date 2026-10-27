import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { connect } from "../../src/index.ts";
import { Post } from "../fixtures/models/post.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";
import { SLOW_RUNS, SLOW_TIMEOUT } from "../support/properties.ts";

/** Repeated titles and published flags, so distinct() changes how many rows there are. */
const POSTS = [
  [1, "A", 1],
  [2, "B", 0],
  [3, "B", 0],
  [4, "C", 1],
  [5, "A", 0],
  [6, "B", 1],
  [7, "C", 1],
  [8, "A", 0],
] as const;

const selections = [undefined, ["title"], ["published"], ["title", "published"]] as const;
const conditions = [undefined, { published: true }, { title: "B" }, { title: ["A", "C"] }] as const;

// exists() is a cheaper toArray().length > 0: whatever the Relation, they agree (#222).
describe("exists(), for any Relation", { timeout: SLOW_TIMEOUT }, () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  const posts = () => connect(binding).model(Post);

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
    await binding.batch([
      binding.prepare("INSERT INTO users (id, email) VALUES (1, 'a@example.com')"),
      ...POSTS.map(([id, title, published]) =>
        binding
          .prepare("INSERT INTO posts (id, user_id, title, published) VALUES (?, 1, ?, ?)")
          .bind(id, title, published),
      ),
    ]);
  });
  afterAll(() => dispose());

  const relations = fc.record({
    select: fc.constantFrom(...selections),
    distinct: fc.boolean(),
    where: fc.constantFrom(...conditions),
    limit: fc.option(fc.nat({ max: 10 }), { nil: undefined }),
    offset: fc.option(fc.nat({ max: 10 }), { nil: undefined }),
  });

  test("is whether toArray() returns any record", async () => {
    await fc.assert(
      fc.asyncProperty(relations, async ({ select, distinct, where, limit, offset }) => {
        let relation = posts();
        if (select !== undefined) relation = relation.select(...select);
        if (distinct) relation = relation.distinct();
        if (where !== undefined) relation = relation.where(where);
        if (limit !== undefined) relation = relation.limit(limit);
        if (offset !== undefined) relation = relation.offset(offset);

        expect(await relation.exists()).toBe((await relation.toArray()).length > 0);
      }),
      SLOW_RUNS,
    );
  });
});
