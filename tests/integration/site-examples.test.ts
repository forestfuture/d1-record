import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { connect } from "../../src/index.ts";
import { publishDraftsAndRemove } from "../../site/snippets/getting-started/batch.ts";
import { Post, User } from "../../site/snippets/getting-started/models.ts";
import worker from "../../site/snippets/getting-started/worker.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

// The documentation's Getting started runs as written, on its own migration.
describe("Getting started", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  const migration = new URL(
    "../../site/snippets/getting-started/0001_create_users_and_posts.sql",
    import.meta.url,
  );

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase(migration));
  });
  afterAll(() => dispose());

  // The Worker's Env, as `wrangler types` would declare it; Miniflare's D1 stands in for it.
  const env = () => ({ DB: binding }) as unknown as Parameters<typeof worker.fetch>[1];

  function request(method: string, body?: unknown): Promise<Response> {
    const init = body === undefined ? { method } : { method, body: JSON.stringify(body) };
    return worker.fetch(new Request("https://example.com/", init), env());
  }

  test("POST signs up a user with a first post; a taken email is a 422 with its errors", async () => {
    const created = await request("POST", { email: "Ada@Example.com" });
    const again = await request("POST", { email: "ada@example.com" });

    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ email: "ada@example.com", isActive: true });
    expect(again.status).toBe(422);
    expect(await again.json()).toEqual({ errors: ["Email has already been taken"] });
  });

  test("GET lists active users, newest first, each with their posts", async () => {
    await request("POST", { email: "grace@example.com" });

    const users = (await (await request("GET")).json()) as { email: string }[];

    expect(users.map((user) => user.email)).toEqual(["grace@example.com", "ada@example.com"]);
    // Associations aren't part of toJSON(), so the posts were preloaded but not serialized.
    const db = connect(binding);
    const [grace] = await db
      .model(User)
      .where({ email: "grace@example.com" })
      .includes("posts")
      .toArray();
    expect(grace!.loaded("posts").map((post) => post.title)).toEqual(["Hello, D1"]);
  });

  test("a batch publishes the drafts and destroys a user with their posts, atomically", async () => {
    const db = connect(binding);
    const ada = await db.model(User).findByOrThrow({ email: "ada@example.com" });

    await publishDraftsAndRemove(db, ada);

    expect(await db.model(User).pluck("email")).toEqual(["grace@example.com"]);
    expect(await db.model(Post).where({ publishedAt: null }).count()).toBe(0);
    expect(await db.model(Post).count()).toBe(1);
  });
});
