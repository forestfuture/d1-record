# Getting started

A [Worker](https://developers.cloudflare.com/workers/) is a function that runs at Cloudflare's edge, and [D1](https://developers.cloudflare.com/d1/) is its SQLite database. d1-record sits between the two: you describe each table once as a **Model**, and your Worker reads and writes **records** instead of rows.

::: warning Not on npm yet
d1-record hasn't been published yet: the first release is coming. Its behavior is tested against real D1, but the API may still change before 1.0.
:::

## Install

```sh
npm install @forestfuture/d1-record
```

It's ESM-only, runs on the Workers runtime, and needs no Node.js compatibility flags.

## 1. Create the tables

D1 tables are created with SQL migrations. Create the database and a first migration with [Wrangler](https://developers.cloudflare.com/workers/wrangler/), Cloudflare's command-line tool:

```sh
npx wrangler d1 create my-app-db
npx wrangler d1 migrations create my-app-db create_users_and_posts
```

Then write the tables in the migration file it creates. Column names are snake_case:

<<< @/snippets/getting-started/0001_create_users_and_posts.sql{sql} [migrations/0001_create_users_and_posts.sql]

Apply it with `npx wrangler d1 migrations apply my-app-db --local`, or `--remote` for the deployed database.

## 2. Connect the database to your Worker

`wrangler d1 create` prints a snippet for your Wrangler config. It gives your Worker a **binding** called `DB`: a handle to the database that arrives with every request, as `env.DB`.

```jsonc [wrangler.jsonc]
{
  "d1_databases": [
    { "binding": "DB", "database_name": "my-app-db", "database_id": "<the id it printed>" },
  ],
}
```

## 3. Declare your models

Each Model describes one table: its attributes (camelCase in your code, snake_case in the table), its associations to other Models, and the rules for saving it.

<<< @/snippets/getting-started/models.ts{ts} [src/models.ts]

A few things to notice:

- The attributes are declared once, and TypeScript infers `user.email`, `user.isActive` and the rest from them.
- The `id` is generated in code, so a new user has its key before it's saved. That's what lets a user and their posts be written together, atomically.
- `User.posts` finds its foreign key by Rails' convention: `userId` on `Post`, from the class name `User`. `Post.author` is named `author`, not `user`, so it says which key it uses.
- Each association needs a `declare` line, so TypeScript knows `user.posts()` and `post.author()`.

## 4. Use them in your Worker

Each request connects to the database with `connect(env.DB)`, then works through `db.model(...)`. (`npx wrangler types` generates the `Env` type from your Wrangler config.)

<<< @/snippets/getting-started/worker.ts{ts} [src/index.ts]

`db.model(User)` is where every query starts. Nothing about the request is ever stored on the `User` class, so concurrent requests on one Worker never share a connection.

## 5. Write several things at once, or not at all

D1 can't keep a transaction open while your code awaits, so there's no `transaction()` block. Instead, `db.batch([...])` sends a prepared set of writes that all succeed or all fail. `record.toSave()` and `record.toDestroy()` turn a record into its save or destroy for the batch; on their own they write nothing:

<<< @/snippets/getting-started/batch.ts#batch{ts}

## Next steps

- [Models](./models): attributes, types, defaults and naming.
- [Querying](./querying): Relations, conditions, scopes and preloading.
- [Saving and destroying](./persistence): what each method returns, and when it throws.
- [D1's limits](./d1): what's different from a database with interactive transactions.

Every larger example on this site is type-checked against the library and runs against a real D1 in the test suite.
