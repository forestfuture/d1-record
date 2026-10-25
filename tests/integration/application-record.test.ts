import { afterAll, beforeAll, describe, expect, expectTypeOf, test, vi } from "vite-plus/test";
import { connect, type QueryEvent } from "../../src/index.ts";
import { Customer } from "../fixtures/models/customer.ts";
import { Post } from "../fixtures/models/post.ts";
import { User } from "../fixtures/models/user.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

// Statics read the Worker's bindings from cloudflare:workers; here it's this test's D1.
const workers: { env: Record<string, unknown> } = { env: {} };
vi.mock("cloudflare:workers", () => workers);

describe("Models extending the app's base class", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  const db = () => connect(binding);

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
    workers.env.DB = binding;
  });
  afterAll(() => dispose());

  test("a Model has its table's attributes, its table named after its class", async () => {
    const user = await db().model(User).create({ email: "ada@example.com" });
    const post = await db().model(Post).create({ userId: user.id, title: "Hello" });

    const found = await db().model(Post).find(post.id);

    expect(found.title).toBe("Hello");
    expect(found.shout).toBe("HELLO");
    expect(Post.table).toBe("posts");
  });

  test("its statics query the binding in the generated schema", async () => {
    const user = await User.create({ email: "grace@example.com" });
    await Post.create({ userId: user.id, title: "First" });
    await Post.create({ userId: user.id, title: "Second" });

    const titles = await Post.where({ userId: user.id }).order({ title: "desc" }).pluck("title");
    const titled = await Post.titled("First").toArray();

    expect(titles).toEqual(["Second", "First"]);
    expect(titled.map((post) => post.title)).toEqual(["First"]);
  });

  test("build and permit take its attributes, and only those", () => {
    const input = { title: "Draft", admin: true };

    const post = Post.build(Post.permit(input, "title"));

    expect(post.attributes()).toMatchObject({ title: "Draft" });
    expect(post).not.toHaveProperty("admin");
  });

  test("static table names a table the class name doesn't give", async () => {
    const customer = await Customer.create({ htmlUrl: "https://example.com" });

    const found = await Customer.find(customer.id);

    expect(found.htmlUrl).toBe("https://example.com");
    expect(Customer.table).toBe("accounts");
  });

  test("static attributes change how a column reads, in its type and its value", async () => {
    const post = await Post.create({ userId: 1, title: "Out", published: true });

    const found = await Post.find(post.id);

    expect(found.published).toBe(true);
    expectTypeOf(found.published).toEqualTypeOf<boolean>();
  });

  test("an attribute overridden as false is never read, so queries name their columns", async () => {
    const events: QueryEvent[] = [];
    await connect(binding, { onQuery: (event) => events.push(event) })
      .model(Customer)
      .toArray();

    expect(events[0]?.sql).not.toContain("*");
    expect(events[0]?.sql).not.toContain("person_identifier");
    expect(Customer.build({})).not.toHaveProperty("personIdentifier");
    expectTypeOf<Customer>().not.toHaveProperty("personIdentifier");
  });
});
