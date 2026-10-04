---
description: "Test Models against a real D1 database with Vitest and Miniflare: create the tables, give the Models a database with withDatabase or db.model, and mock cloudflare:workers for code that relies on the binding."
---

# Test with Miniflare

[Miniflare](https://developers.cloudflare.com/workers/testing/miniflare/) runs Cloudflare's runtime, D1 included, inside Node. Tests can then use a real D1 database, with your migrations applied, instead of a fake. d1-record's own test suite works this way.

## Create a database with your tables

Start Miniflare with a D1 database, and apply your migrations to it, in order:

```ts [test/d1.ts]
import { readdirSync, readFileSync } from "node:fs";
import { Miniflare } from "miniflare";

export async function testDatabase() {
  const mf = new Miniflare({ modules: true, script: "export default {}", d1Databases: ["DB"] });
  const binding = await mf.getD1Database("DB");
  for (const file of readdirSync("migrations").sort()) {
    await binding.exec(readFileSync(`migrations/${file}`, "utf8").replaceAll("\n", " "));
  }
  return { binding, dispose: () => mf.dispose() };
}
```

(`exec` runs one statement per line, hence the joined lines.)

## Give your Models the database

Outside a Worker there's no `env.DB`, so a query from a Model needs to be told its database. Run the test's code inside `withDatabase`:

```ts [test/users.test.ts]
import { connect, withDatabase } from "@forestfuture/d1-record";
import { afterAll, beforeAll, expect, test } from "vitest";
import { User } from "../src/models/user";
import { testDatabase } from "./d1";

let database: Awaited<ReturnType<typeof testDatabase>>;
beforeAll(async () => (database = await testDatabase()));
afterAll(() => database.dispose());

test("emails are saved in lowercase", async () => {
  await withDatabase(connect(database.binding), async () => {
    const user = await User.create({ email: "Ada@Example.com" });
    expect((await User.find(user.id)).email).toBe("ada@example.com");
  });
});
```

Code that takes a database explicitly can be given one directly instead: `connect(database.binding).model(User)`.

`withDatabase` runs here without any setup: Node has `AsyncLocalStorage` built in.

## Code that relies on the binding

A Worker's own code, such as its `fetch` handler, queries through each Model's binding, which comes from `cloudflare:workers`. That module only exists inside a Worker, so give tests one, with Vitest's module mocking:

```ts [test/worker.test.ts]
import { beforeAll, expect, test, vi } from "vitest";
import worker from "../src/index";
import { testDatabase } from "./d1";

const workers = { env: {} as Record<string, unknown> };
vi.mock("cloudflare:workers", () => workers);

beforeAll(async () => {
  workers.env = { DB: (await testDatabase()).binding };
});

test("GET lists users", async () => {
  const response = await worker.fetch(new Request("https://example.com/"));
  expect(response.status).toBe(200);
});
```

Each test file gets its own database this way. To run tests inside the Workers runtime itself, see Cloudflare's [Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/), where `cloudflare:workers` is real.
