import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { connect, withDatabase } from "../../src/index.ts";
import {
  Article,
  Author,
  autosaveExample,
  belongsToExample,
  createThroughExample,
  hasManyExample,
  hasOneExample,
  preloadExample,
  readExample,
  statementsExample,
  writersExample,
} from "../../site/snippets/guide/associations.ts";
import * as batches from "../../site/snippets/guide/batches.ts";
import { Booking, errorsExample } from "../../site/snippets/guide/validations.ts";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGenerate } from "../../cli/generate/command.ts";
import { runSchema } from "../../cli/schema/command.ts";
import { Post, User } from "../../site/snippets/getting-started/models.ts";
import worker from "../../site/snippets/getting-started/src/index.ts";
import { publishDraftsAndRemove } from "../../site/snippets/getting-started/src/publish.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

// Inside a Worker, a Model's binding comes from cloudflare:workers; here, Miniflare's D1 stands in.
const workers: { env: Record<string, unknown> } = { env: {} };
vi.mock("cloudflare:workers", () => workers);

// The Getting started project: the generators' own output (its migrations, schema.ts and
// application-record.ts), with the tutorial's edits to the Models.
const gettingStarted = new URL("../../site/snippets/getting-started/", import.meta.url);
const gettingStartedMigrations = ["0001_create_users.sql", "0002_create_posts.sql"].map(
  (file) => new URL(`migrations/${file}`, gettingStarted),
);

// The documentation's Getting started runs as written, on its own migrations.
describe("Getting started", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase(gettingStartedMigrations));
    workers.env = { DB: binding };
  });
  afterAll(() => dispose());

  test("its files are what the tutorial's two g model commands write, apart from its edit to user.ts", () => {
    const fresh = mkdtempSync(join(tmpdir(), "getting-started-"));
    writeFileSync(
      join(fresh, "wrangler.jsonc"),
      readFileSync(new URL("wrangler.jsonc", gettingStarted)),
    );
    const quiet = () => {};
    runGenerate(
      {
        cwd: fresh,
        kind: "model",
        name: "User",
        columns: ["email:string!:unique", "isActive:boolean!=true"],
      },
      quiet,
    );
    runGenerate(
      {
        cwd: fresh,
        kind: "model",
        name: "Post",
        columns: ["user:references", "title:string!", "publishedAt:datetime"],
      },
      quiet,
    );

    for (const file of [
      "migrations/0001_create_users.sql",
      "migrations/0002_create_posts.sql",
      "src/db/schema.ts",
      "src/models/application-record.ts",
      "src/models/post.ts",
    ]) {
      expect([file, readFileSync(join(fresh, file), "utf8")]).toEqual([
        file,
        readFileSync(new URL(file, gettingStarted), "utf8"),
      ]);
    }
  });

  test("its schema.ts is what its migrations generate", () => {
    const output: string[] = [];

    expect(
      runSchema({ cwd: gettingStarted.pathname, check: true }, (line) => output.push(line)),
    ).toBe(0);
  });

  function request(method: string, body?: unknown): Promise<Response> {
    const init = body === undefined ? { method } : { method, body: JSON.stringify(body) };
    return worker.fetch(new Request("https://example.com/", init));
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
    // Loaded as the example's statements are, on the current database, so they share a batch.
    const ada = await User.findByOrThrow({ email: "ada@example.com" });

    await publishDraftsAndRemove(ada);

    expect(await db.model(User).pluck("email")).toEqual(["grace@example.com"]);
    expect(await db.model(Post).where({ publishedAt: null }).count()).toBe(0);
    expect(await db.model(Post).count()).toBe(1);
  });
});

// The guide's larger examples, on the tables they're written for.
describe("the guide's examples", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  const schema = new URL("../../site/snippets/guide/schema.sql", import.meta.url);

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase(schema));
  });
  afterAll(() => dispose());
  // The examples log what they show; the tests check it here rather than print it.
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  afterAll(() => log.mockRestore());
  beforeEach(async () => {
    log.mockClear();
    await binding.batch([
      binding.prepare("DELETE FROM comments"),
      binding.prepare("DELETE FROM profiles"),
      binding.prepare("DELETE FROM articles"),
      binding.prepare("DELETE FROM authors"),
      binding.prepare("INSERT INTO authors (id, name) VALUES ('mary', 'Mary')"),
      binding.prepare(
        "INSERT INTO articles (id, author_id, title, published, created_at) VALUES ('x1', 'mary', 'On Nothing', 1, '2026-01-01T00:00:00.000Z')",
      ),
      binding.prepare("INSERT INTO profiles (author_id, bio) VALUES ('mary', 'Poet')"),
      binding.prepare("INSERT INTO comments (article_id, body) VALUES ('x1', 'Hm.')"),
    ]);
  });

  test("Validations: the errors example has the five errors its comments show", async () => {
    const account = await withDatabase(connect(binding), () => errorsExample());

    expect(account.errors.fullMessages()).toEqual([
      "Email can't be blank",
      "Handle is too short (minimum is 3 characters)",
      "Handle is invalid",
      "Plan is not included in the list",
      "Seats is not a number",
    ]);
    expect(account.errors.toArray()[0]).toEqual({
      attribute: "email",
      type: "blank",
      message: "can't be blank",
    });
    expect(log).toHaveBeenCalledWith(5);
  });

  test("Validations: a custom rule added in afterValidation makes the record invalid", async () => {
    const at = new Date("2026-05-01T10:00:00Z");
    const booking = connect(binding).model(Booking).build({ startsAt: at, endsAt: at });

    expect(await booking.isValid()).toBe(false);
    expect(booking.errors.fullMessages()).toEqual(["Ends at must be after the start"]);
  });

  test("Associations: reading, creating through, and deleting through an association", async () => {
    const db = connect(binding);
    const { author, profile, latest } = await withDatabase(db, () => readExample("x1"));
    const comment = await withDatabase(db, () => createThroughExample("x1"));

    expect([author?.name, profile?.bio, latest?.title]).toEqual(["Mary", "Poet", "On Nothing"]);
    expect(comment.articleId).toBe("x1");

    await statementsExample(await db.model(Article).find("x1"));
    expect(
      await db
        .model(Article)
        .find("x1")
        .then((article) => article.comments().count()),
    ).toBe(0);
  });

  test("Associations: each kind's reference example, as the guide shows it", async () => {
    const db = connect(binding);
    const editor = await db.model(Author).createOrThrow({ name: "Ed" });

    const articles = await withDatabase(db, () => hasManyExample("mary")); // builds an Untitled one, then deletes it
    const author = await withDatabase(db, () => belongsToExample("x1", editor));
    const profile = await withDatabase(db, () => hasOneExample("mary"));

    expect(articles.map((article) => article.title)).toEqual(["On Nothing"]);
    expect(author?.name).toBe("Mary");
    expect(await db.model(Article).pluck("authorId", "title")).toEqual([[editor.id, "On Nothing"]]);
    expect(profile?.bio).toBe("Poet");
  });

  test("Associations: autosave writes the graph in one batch; set() links new and saved authors", async () => {
    const queries: string[] = [];
    const db = connect(binding, { onQuery: ({ sql }) => queries.push(sql) });
    const ada = await withDatabase(db, () => autosaveExample());
    const batched = queries.length;
    const { draft, another, grace } = await withDatabase(db, () => writersExample(ada));

    expect(batched).toBe(4); // the author, two articles and the profile (atomicity: autosave tests)
    expect(await db.model(Article).where({ authorId: ada.id }).pluck("title")).toEqual(
      expect.arrayContaining([
        "Notes on the Analytical Engine",
        "Sketch of the Engine",
        "Untitled",
      ]),
    );
    expect((await ada.profile())?.bio).toBe("Mathematician");
    expect(draft.authorId).toBe(ada.id);
    expect(grace.isPersisted()).toBe(true);
    expect(another.authorId).toBe(grace.id);
  });

  test("Associations: the preload takes 4 queries, and the loop none", async () => {
    await withDatabase(connect(binding), () => autosaveExample());
    const queries: string[] = [];

    const authors = await withDatabase(
      connect(binding, { onQuery: ({ sql }) => queries.push(sql) }),
      () => preloadExample(),
    );

    expect(authors.map((author) => author.name).sort()).toEqual(["Ada", "Mary"]);
    expect(queries).toHaveLength(4);
    expect(log).toHaveBeenCalledWith("Mary", 1, "Poet");
    expect(log).toHaveBeenCalledWith("Ada", 2, "Mathematician");
  });

  test("Batches: statements, many rows, an atomic batch, and records in a batch", async () => {
    const db = connect(binding);

    const meta = await withDatabase(db, () => batches.statementsExample("x1"));
    await withDatabase(db, () => batches.insertAllExample("x1"));
    const graceId = await withDatabase(db, () => batches.batchExample());

    expect(meta.changes).toBe(1);
    expect(log).toHaveBeenCalledWith(1, meta.last_row_id); // the article's one comment deleted
    expect(
      await db
        .model(Article)
        .find("x1")
        .then((article) => article.title),
    ).toBe("EDITED");
    expect(
      await db
        .model(Author)
        .find("author-1")
        .then((author) => author.name),
    ).toBe("Ada");
    expect(await db.model(Article).where({ authorId: graceId }).pluck("title")).toEqual(["Hello"]);

    const { savedAuthor } = await withDatabase(db, () => batches.recordsExample("x1", graceId));

    expect(savedAuthor.isPersisted()).toBe(true);
    expect(
      await db
        .model(Article)
        .find("x1")
        .then((article) => article.title),
    ).toBe("Final");
    expect(await db.model(Author).exists({ id: graceId })).toBe(false); // and its article, dependent
    expect(await db.model(Article).where({ authorId: graceId }).count()).toBe(0);
    expect(
      await db
        .model(Article)
        .find("x1")
        .then((article) => article.comments().count()),
    ).toBe(0);
  });
});

// Change a table: code deployed before a migration adds a column keeps working.
describe("Change a table", () => {
  test("code that doesn't declare a newer column keeps working, as the guide says", async () => {
    const { db: binding, dispose } = await createTestDatabase(gettingStartedMigrations);
    await binding.prepare("ALTER TABLE users ADD COLUMN bio TEXT").run();
    await binding
      .prepare(
        "INSERT INTO users (id, email, bio, created_at, updated_at) VALUES ('u1', 'a@example.com', 'hi', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
      )
      .run();
    // The User of Getting started, deployed before the migration: no bio attribute.
    const db = connect(binding);
    const user = await db.model(User).find("u1");

    user.email = "b@example.com";
    await user.save();
    await user.reload();
    const created = await db.model(User).create({ email: "c@example.com" });

    expect(user.email).toBe("b@example.com");
    expect(created.isPersisted()).toBe(true);
    expect(JSON.stringify(user)).not.toContain("bio");
    await dispose();
  });
});
