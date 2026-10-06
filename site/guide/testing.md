---
description: "Test Models and your Worker against a real D1 database with Vitest and Miniflare: create the tables from your migrations, and give the code a database with withDatabase."
---

# Testing

[Miniflare](https://developers.cloudflare.com/workers/testing/miniflare/) runs Cloudflare’s runtime, D1 included, inside Node. Tests can then use a real D1 database, with your migrations applied, instead of a fake. d1-record’s own test suite works this way.

```sh
npm install --save-dev vitest miniflare@4
```

## Create a database with your tables

Start Miniflare with a D1 database, and apply your migrations to it, in order:

```ts [test/d1.ts]
import { readdirSync, readFileSync } from "node:fs";
import { Miniflare } from "miniflare";

export async function testDatabase() {
  const mf = new Miniflare({ modules: true, script: "export default {}", d1Databases: ["DB"] });
  const binding = await mf.getD1Database("DB");
  for (const file of readdirSync("migrations").sort()) {
    // Each migration's statements, without its comments, applied together.
    const statements = readFileSync(`migrations/${file}`, "utf8")
      .replace(/^\s*--.*$/gm, "")
      .split(/;\s*$/m)
      .map((statement) => statement.trim())
      .filter(Boolean);
    if (statements.length > 0)
      await binding.batch(statements.map((statement) => binding.prepare(statement)));
  }
  return { binding, dispose: () => mf.dispose() };
}
```

## Give your Models the database

Outside a Worker there’s no `env.DB`, so a query from a Model needs to be told its database. Run the test’s code inside `withDatabase`:

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

Outside a Worker, the database given to `withDatabase` serves every Model, whatever binding its base class names. Code that takes a database explicitly can be given one directly instead: `connect(database.binding).model(User)`. `withDatabase` needs no setup here: Node has `AsyncLocalStorage` built in.

## Test your Worker’s handler

Your Worker’s `fetch` handler queries through each Model’s binding, which only exists inside a Worker. Call it inside `withDatabase` too, and its queries use the test’s database:

```ts [test/worker.test.ts]
import { connect, withDatabase } from "@forestfuture/d1-record";
import { afterAll, beforeAll, expect, test } from "vitest";
import worker from "../src/index";
import { testDatabase } from "./d1";

let database: Awaited<ReturnType<typeof testDatabase>>;
beforeAll(async () => (database = await testDatabase()));
afterAll(() => database.dispose());

test("GET lists users", async () => {
  const response = await withDatabase(connect(database.binding), () =>
    worker.fetch(new Request("https://example.com/")),
  );
  expect(response.status).toBe(200);
});
```

Each test file gets its own database this way. To run tests inside the Workers runtime itself, see Cloudflare’s [Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/).
