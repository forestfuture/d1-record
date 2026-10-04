---
description: "Use d1-record with a D1 database that Drizzle or Prisma manages, or one with no migrations at all: point it at the migrations, read its notes, and fix columns with overrides."
---

# Adopt an existing database

d1-record reads a database's tables from its migrations. If your database already has them (from Drizzle, Prisma or Wrangler), point d1-record at them. If it doesn't, start from a snapshot of the database's schema.

## Coming from Drizzle

Drizzle writes its migrations to `drizzle/` (its `out` setting). Tell Wrangler where they are, in your Wrangler config:

```jsonc [wrangler.jsonc]
{
  "d1_databases": [
    // Migrations as drizzle/0000_name.sql:
    { "binding": "DB", "database_name": "my-app-db", "migrations_dir": "drizzle" },
    // Or, as drizzle/<timestamp>_name/migration.sql:
    // { …, "migrations_pattern": "drizzle/*/migration.sql" },
  ],
}
```

Drizzle's own schema often lives at `src/db/schema.ts` or in a `src/db/schema/` folder, which is d1-record's default place too. So generate d1-record's elsewhere:

```sh
npx d1-record schema --out src/db/d1-record.ts
```

Then point `src/models/application-record.ts` at it: `import { tables } from "../db/d1-record";`. (Without `--out`, d1-record refuses to write over a file it didn't write, or beside a folder of the same name, and says to use `--out`.)

Pass `--out` to every later `schema` and `g` command, or keep it in a `package.json` script.

## Coming from Prisma

With D1, Prisma's migrations are usually Wrangler's own: files in `migrations/`, written by `prisma migrate diff`. `npx d1-record schema` reads them as they are.

Prisma names tables after its models (`User`) and columns in camelCase (`createdAt`). d1-record keeps both names, so the Model is `ApplicationRecord("User")`, and its attributes are `createdAt` and so on.

## With no migrations at all

For a database built by hand, or by `drizzle-kit push`, start from a snapshot of its schema:

```sh
# The tables, without their data, as a first migration:
npx wrangler d1 export my-app-db --remote --no-data --output migrations/0001_baseline.sql

# Create Wrangler's record of applied migrations, and mark the snapshot as applied,
# so Wrangler never runs it against the database it came from:
npx wrangler d1 migrations list my-app-db --remote
npx wrangler d1 execute my-app-db --remote --command "INSERT INTO d1_migrations (name) VALUES ('0001_baseline.sql')"
```

From then on, change tables with new migrations: see [Change a table](./change-a-table).

## Check the generated attributes

Other tools can store values differently from d1-record's conventions, and some columns then become the wrong attribute type without any error. When `d1-record schema` recognises Drizzle's or Prisma's migrations, it prints a note naming the tool, then one for each column worth checking:

```
Note: these migrations look like Drizzle's. Some columns may convert to the wrong type without an error, especially numeric timestamps: check the generated types (…)
Note: posts.metadata: read as a string; if it holds JSON, override it as "json" in its Model
```

Fix a column's type in its Model, with an override. An override changes how d1-record reads and writes the column, never the table:

<<< @/snippets/guide/adopt.ts#overrides{ts}

::: warning Numeric timestamps
Drizzle's `integer({ mode: "timestamp" })` stores Unix seconds, and Prisma may store a `DateTime` as a number. d1-record's `datetime` reads and writes ISO-8601 text, so it can't read those yet. Leave such columns as `integer` (the default for an `INTEGER` column), and convert with `new Date(seconds * 1000)` where you need a `Date`. Reading numeric timestamps as dates is [#73](https://github.com/forestfuture/d1-record/issues/73).
:::
