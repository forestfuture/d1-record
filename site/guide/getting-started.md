---
description: "From an empty Worker to two related Models, queried and saved, in about ten minutes: install d1-record, generate Models and their tables, add behavior, and use them in a Worker."
---

# Getting started

A [Worker](https://developers.cloudflare.com/workers/) is a function that runs at Cloudflare’s edge, and [D1](https://developers.cloudflare.com/d1/) is its SQLite database. d1-record sits between the two: each table becomes a **Model**, and your Worker reads and writes **records** instead of rows.

In this tutorial you’ll build the start of a small blog: users, and the posts they write. By the end, your Worker will list users with their posts, and sign up a user together with a first post.

::: warning Not on npm yet
d1-record hasn’t been published yet: the first release is coming. Its behavior is tested against real D1, but the API may still change before 1.0.
:::

## Before you start

You need:

- **A Worker project** with [Wrangler](https://developers.cloudflare.com/workers/wrangler/), Cloudflare’s command-line tool. `npm create cloudflare@latest` makes one.
- **A D1 database bound as `DB`.** Create one with `npx wrangler d1 create my-app-db`, and add the snippet it prints to your Wrangler config:

  ```jsonc [wrangler.jsonc]
  {
    "d1_databases": [
      { "binding": "DB", "database_name": "my-app-db", "database_id": "<the id it printed>" },
    ],
  }
  ```

- **Node.js 22.13 or later**, for d1-record’s command line.

## 1. Install d1-record

```sh
npm install @forestfuture/d1-record
```

## 2. Generate the Models

d1-record’s generator writes a table’s migration and its Model in one step, as Rails’ `rails generate model` does. Generate users first, then posts, since each post belongs to a user:

```sh
npx d1-record g model User 'email:string!:unique' 'isActive:boolean!=true'
npx d1-record g model Post user:references 'title:string!' publishedAt:datetime
```

Each column is `name:type`. A `!` makes it required (`NOT NULL`), `=true` gives it a default, `:unique` adds a unique index, and `user:references` links each post to a user. (The quotes keep your shell from reading the `!`.)

The generator prints what it wrote:

```
Wrote migrations/0001_create_users.sql
Wrote src/models/user.ts
Wrote src/db/schema.ts (1 table) from migrations/
Wrote src/models/application-record.ts
Next: npx wrangler d1 migrations apply my-app-db --local
```

Here’s what each file is for:

| File                                                        | What it is                                                                   |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `migrations/0001_create_users.sql`, `0002_create_posts.sql` | The SQL that creates each table. Wrangler applies these, in order.           |
| `src/db/schema.ts`                                          | Every table’s columns, generated from the migrations. You never edit it.     |
| `src/models/application-record.ts`                          | Your app’s base class, `ApplicationRecord`, as in Rails. It’s yours to edit. |
| `src/models/user.ts`, `post.ts`                             | One Model per table.                                                         |

The migration for posts shows what the generator wrote from its columns:

<<< @/snippets/getting-started/migrations/0002_create_posts.sql{sql} [migrations/0002_create_posts.sql]

Each record gets an `id` generated in code, so a new user has its key before it’s saved. That’s what lets a user and their posts be written together, atomically. `created_at` and `updated_at` are filled in for you.

## 3. Create the tables

Apply the migrations to your local database:

```sh
npx wrangler d1 migrations apply my-app-db --local
```

Use `--remote` instead when you deploy.

## 4. Add behavior to the Models

The generated `Post` already knows it belongs to a user, from `user:references`:

<<< @/snippets/getting-started/src/models/post.ts{ts} [src/models/post.ts]

The generated `User` is a single line:

```ts [src/models/user.ts]
import { ApplicationRecord } from "./application-record";

export class User extends ApplicationRecord("users") {}
```

Its attributes come from the generated schema, so `user.email` and `user.isActive` are already there, typed. A Model only declares behavior. Open `src/models/user.ts` and give it a user’s posts, a way to find active users, and rules for saving:

<<< @/snippets/getting-started/src/models/user.ts{ts} [src/models/user.ts]

- `posts = hasMany(Post, …)` is an association: `user.posts()` finds the user’s posts. `dependent: "destroy"` destroys them along with the user.
- `static active = this.scope(…)` is a scope: `User.active()` finds active users.
- `this.validates(…)` and `this.beforeSave(…)` run on every save. An invalid user isn’t saved, and its errors say why.

## 5. Use the Models in your Worker

Queries start from the Model, as in Rails. Each Model uses the `DB` binding during the request, so there’s nothing to connect:

<<< @/snippets/getting-started/src/index.ts{ts} [src/index.ts]

- `User.active().includes("posts")` loads the users, then all their posts in one more query, however many users there are.
- `user.posts().build(…)` makes a post that’s saved with its user, in one atomic batch.
- `save()` resolves to `false` when validation fails, with the reasons in `user.errors`.

## 6. Try it

Start the Worker locally:

```sh
npx wrangler dev
```

Then, in another terminal, sign up a user, and list the users:

```sh
curl -X POST http://localhost:8787 -d '{"email":"Ada@Example.com"}'
curl http://localhost:8787
```

The second request returns Ada, with her email lowercased by the `beforeSave` callback. Sign her up again, and the response is a `422` with `["Email has already been taken"]`.

## Next steps

You’ve generated two Models, created their tables, added behavior, and used them in a Worker.

- **[Generators](./generators):** change a table, and every way to write columns.
- **[Models](./models):** attributes, types, overrides and shared behavior.
- **[Querying](./querying):** conditions, ordering, scopes and preloading.
- **[Persistence](./persistence):** what each method returns, and when it throws.
- **[Bulk writes and batches](./batches):** several changes that all succeed or all fail, since D1 has no transactions.
- **[Connections](./connecting):** read replicas, logging, tests and several databases.

Every larger example on this site is type-checked against d1-record and runs against a real D1 database in its test suite, including this tutorial.
