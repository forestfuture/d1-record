---
description: "From an empty Worker to two related Models in about ten minutes: install d1-record, generate Models and their tables, add behavior, and use them in a Worker."
---

# Getting started

d1-record turns each table in your [D1](https://developers.cloudflare.com/d1/) database into a Model, so your [Worker](https://developers.cloudflare.com/workers/) works with records instead of rows. In this tutorial you’ll build the start of a small blog: users, and the posts they write.

::: warning Not on npm yet
d1-record hasn’t been published yet. Its behavior is tested against real D1, but the API may change before 1.0.
:::

## Prerequisites

You’ll need:

- **A Worker project** with [Wrangler](https://developers.cloudflare.com/workers/wrangler/). `npm create cloudflare@latest` makes one.
- **A D1 database bound as `DB`.** Create one with `npx wrangler d1 create my-app-db`, then add the snippet it prints to your Wrangler config:

  ```jsonc [wrangler.jsonc]
  {
    "d1_databases": [
      { "binding": "DB", "database_name": "my-app-db", "database_id": "<the id it printed>" },
    ],
  }
  ```

- **Node.js 22.13 or later**, for the command line.

## Installing d1-record

```sh
npm install @forestfuture/d1-record
```

## Generating the Models

The generator writes a table’s migration and its Model in one step, like `rails generate model`. Generate users first, since each post belongs to a user:

```sh
npx d1-record g model User 'email:string!:unique' 'isActive:boolean!=true'
npx d1-record g model Post user:references 'title:string!' publishedAt:datetime
```

Each column is `name:type`. A `!` makes it required, `=true` sets a default, `:unique` adds a unique index, and `user:references` links each post to a user. The quotes stop your shell from reading the `!`.

The generator writes these files:

| File                                                        | What it is                                                           |
| ----------------------------------------------------------- | -------------------------------------------------------------------- |
| `migrations/0001_create_users.sql`, `0002_create_posts.sql` | The SQL that creates each table                                      |
| `src/db/schema.ts`                                          | Every table’s columns, generated from the migrations. Don’t edit it. |
| `src/models/application-record.ts`                          | Your app’s base class. It’s yours to edit.                           |
| `src/models/user.ts`, `post.ts`                             | One Model per table                                                  |

Here’s the migration for posts:

<<< @/snippets/getting-started/migrations/0002_create_posts.sql{sql} [migrations/0002_create_posts.sql]

::: warning TIP
Each `id` is generated in code, so a new user has its key before it’s saved. That lets a user and their posts be written together, atomically.
:::

## Creating the tables

Apply the migrations to your local database:

```sh
npx wrangler d1 migrations apply my-app-db --local
```

Use `--remote` when you deploy.

## Adding behavior

A Model’s attributes come from the generated schema, so a Model only declares behavior. The generated `Post` already belongs to a user:

<<< @/snippets/getting-started/src/models/post.ts{ts} [src/models/post.ts]

The generated `User` is one line:

```ts [src/models/user.ts]
import { ApplicationRecord } from "./application-record";

export class User extends ApplicationRecord("users") {}
```

Give it posts, a scope for active users, and rules for saving:

<<< @/snippets/getting-started/src/models/user.ts{ts} [src/models/user.ts]

- `user.posts()` finds the user’s posts, and `dependent: "destroy"` destroys them with the user.
- `User.active()` finds active users.
- `validates` and `beforeSave` run on every save. An invalid user isn’t saved, and `user.errors` says why.

## Using the Models

Queries start from the Model. Each Model uses the `DB` binding, so there’s nothing to connect:

<<< @/snippets/getting-started/src/index.ts{ts} [src/index.ts]

- `includes("posts")` loads every user’s posts in one more query.
- A post built with `user.posts().build(…)` is saved with its user, in one atomic batch.
- `save()` resolves to `false` when validation fails.

## Trying it

Start the Worker:

```sh
npx wrangler dev
```

In another terminal, sign up a user, then list the users:

```sh
curl -X POST http://localhost:8787 -d '{"email":"Ada@Example.com"}'
curl http://localhost:8787
```

The list includes Ada, with her email lowercased by `beforeSave`. Sign her up again, and you’ll get a `422` with `["Email has already been taken"]`.

## Next steps

- **[Models](./models):** attributes, types, and overrides.
- **[Querying](./querying):** conditions, ordering, scopes, and preloading.
- **[Persistence](./persistence):** saving and destroying records.
- **[Associations](./associations):** `hasMany`, `belongsTo`, and `hasOne`.
- **[Generators](./generators):** every way to write columns.
- **[Bulk writes and batches](./batches):** writing several changes at once.
