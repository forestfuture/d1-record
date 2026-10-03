---
description: "Creating and changing D1 tables with Wrangler's migrations, and how a migration's columns map to a Model's attributes."
---

# Migrations

d1-record doesn't create or change tables. A Model describes a table that already exists, and its columns come from **D1 migrations**: numbered SQL files that Wrangler applies in order, recording each one in the database (a `d1_migrations` table), so each runs once. Follow Cloudflare's guide to [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/) and the [`wrangler d1 migrations` commands](https://developers.cloudflare.com/workers/wrangler/commands/d1/#d1-migrations-create). This page covers how they fit with your Models.

## The commands

```sh
npx wrangler d1 migrations create my-app-db add_bio_to_users  # a new, numbered file in migrations/
npx wrangler d1 migrations list my-app-db --local             # the ones not applied yet
npx wrangler d1 migrations apply my-app-db --local            # apply them to the local database
npx wrangler d1 migrations apply my-app-db --remote           # apply them to the deployed database
```

Without `--remote`, these commands use the local database that `wrangler dev` runs against. Wrangler backs up the database before applying migrations to it.

## From a migration to a Model

Write each table as d1-record expects to read it:

- **Columns are snake_case**, and the Model's attributes are their camelCase names: `created_at` is `createdAt`, `user_id` is `userId`. An attribute can map to any column with `{ column: "…" }`.
- **Types** map like this:

  | Attribute  | Column                 |
  | ---------- | ---------------------- |
  | `string`   | `TEXT`                 |
  | `integer`  | `INTEGER`              |
  | `real`     | `REAL`                 |
  | `boolean`  | `INTEGER` (`0` or `1`) |
  | `datetime` | `TEXT` (ISO-8601)      |
  | `json`     | `TEXT`                 |

- **`NOT NULL`** columns are attributes declared `null: false`. Any other attribute can be `null`, as its column can.
- **The primary key** is `id` unless the Model sets `primaryKey`. Use `TEXT PRIMARY KEY` for keys generated in code (`default: () => crypto.randomUUID()`), so records can be [saved together atomically](./d1#generate-keys-in-code), or `INTEGER PRIMARY KEY` for keys D1 generates.
- **Column defaults** (`DEFAULT 1`) apply when a record is inserted without that attribute.
- **Timestamps** are `created_at` and `updated_at` `TEXT` columns, which d1-record fills in.
- **Foreign keys** are enforced when declared with `REFERENCES` (`user_id TEXT NOT NULL REFERENCES users (id)`).
- **A `uniqueness` validation** needs a `UNIQUE` index too, since only the index guarantees it.

[Getting started](./getting-started#_1-create-the-tables) has a first migration, with its Models.

## Changing a table

To add a column, write a migration that adds it, then add the attribute to the Model:

<<< @/snippets/migrations/0002_add_bio_to_users.sql{sql} [migrations/0002_add_bio_to_users.sql]

<<< @/snippets/migrations/models.ts#user{ts} [src/models.ts]

<<< @/snippets/migrations/models.ts#use{ts}

Order matters when the deployed database and the deployed code change separately:

- **Adding a column:** apply the migration with `--remote` first, then deploy the code that uses it. Code that doesn't know the column yet keeps working, since d1-record only writes the attributes a Model declares.
- **Removing a column:** deploy code that no longer declares the attribute first, then apply the migration that drops it.
- **Renaming a column:** rename it in a migration (`ALTER TABLE users RENAME COLUMN bio TO about`), and map the attribute to the new name with `{ column: "about" }`, or rename the attribute too.

SQLite rebuilds a table for some changes, such as changing a column's type. If the table is referenced by foreign keys, start the migration with `PRAGMA defer_foreign_keys = true`, as [Cloudflare describes](https://developers.cloudflare.com/d1/reference/migrations/).

d1-record doesn't yet check that a Model's attributes match its table; a mismatch shows up as a D1 error the first time a query uses it ([#21](https://github.com/forestfuture/d1-record/issues/21)).
