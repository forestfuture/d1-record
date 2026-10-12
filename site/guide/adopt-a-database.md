---
description: "Use d1-record with a D1 database that Drizzle or Prisma manages, or one with no migrations at all: point it at the migrations, read its notes, and fix columns with overrides."
---

# Existing databases

d1-record reads a database’s tables from its migrations. If your database already has migrations, from Drizzle, Prisma, or Wrangler, point d1-record at them. If it doesn’t, start from a snapshot of its schema.

## Using Drizzle’s migrations

Drizzle writes its migrations to `drizzle/`, its `out` setting. Tell Wrangler where they are:

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

Drizzle’s own schema often lives at `src/db/schema.ts` or in `src/db/schema/`, where d1-record writes its schema by default. Generate d1-record’s elsewhere:

```sh
npx d1-record schema --out src/db/d1-record.ts
```

If `src/models/application-record.ts` already exists, point it at the new file with `import { tables } from "../db/d1-record";`. A new one imports it already.

Pass `--out` to every later `schema` and `g` command, or keep it in a `package.json` script.

::: warning TIP
Without `--out`, d1-record refuses to write over a file it didn’t write, or beside a folder of the same name, so Drizzle’s schema is safe.
:::

## Using Prisma’s migrations

With D1, Prisma’s migrations are usually Wrangler’s own: files in `migrations/`, written by `prisma migrate diff`. `npx d1-record schema` reads them as they are.

Prisma names tables after its models, such as `User`, and columns in camelCase, such as `createdAt`. d1-record keeps both names, so the Model is `ApplicationRecord("User")`, with attributes such as `createdAt`.

::: warning Two date formats in one column
Prisma writes a `DateTime` as `2026-10-12T06:38:30.325+00:00`, and a `DEFAULT CURRENT_TIMESTAMP` fills `2026-10-12 06:38:30`. d1-record reads both as UTC, but SQLite compares dates as text, so `order` and `between` on a column with both can misplace values within a day. Rewrite the default-filled rows in a migration, so they match the others:

```sql
UPDATE "Post" SET "createdAt" = replace("createdAt", ' ', 'T') || 'Z'
WHERE "createdAt" NOT LIKE '%T%';
```

Comparing through `datetime()` is tracked in [#143](https://github.com/forestfuture/d1-record/issues/143).
:::

## Starting with no migrations

For a database built by hand, or by `drizzle-kit push`, export a snapshot of its schema as the first migration, and mark it as applied:

```sh
# The tables, without their data, as a first migration:
npx wrangler d1 export my-app-db --remote --no-data --output migrations/0001_baseline.sql

# Create Wrangler's record of applied migrations, and mark the snapshot as applied,
# so Wrangler never runs it against the database it came from:
npx wrangler d1 migrations list my-app-db --remote
npx wrangler d1 execute my-app-db --remote --command "INSERT INTO d1_migrations (name) VALUES ('0001_baseline.sql')"
```

From then on, change tables with new migrations. See [Schema changes](./change-a-table).

## Checking the generated attributes

Other tools can store values differently, so a column can become the wrong attribute type without an error. When `d1-record schema` recognizes Drizzle’s or Prisma’s migrations, it prints a note for each column worth checking:

```
Note: these migrations look like Drizzle's. Some columns may convert to the wrong type without an error, especially numeric timestamps: check the generated types (…)
Note: posts.metadata: read as a string; if it holds JSON, override it as "json" in its Model
```

Fix a column’s type with an override in its Model. It changes how the column is read and written, never the table:

<<< @/snippets/guide/adopt.ts#overrides{ts}

## Reading Unix timestamps

Read a Unix timestamp column as a `Date` by overriding it as a `datetime` with the matching `storage`. Drizzle’s `integer({ mode: "timestamp" })` stores seconds, and `"timestamp_ms"` stores milliseconds:

<<< @/snippets/guide/adopt.ts#timestamps{ts}

| Drizzle mode     | `storage`            |
| ---------------- | -------------------- |
| `"timestamp"`    | `"unixSeconds"`      |
| `"timestamp_ms"` | `"unixMilliseconds"` |

The column stays an `INTEGER`. `createdAt` and `updatedAt` declared this way are written as integers too, and `where` and `between` take `Date`s.

Under `unixSeconds`, a `Date` is stored to the second, so a condition such as `lt(date)` compares to the second too.

::: warning A Date in an sql fragment
A `Date` interpolated into an `sql` fragment is bound as ISO text, because a fragment has no attribute to say otherwise, and it won’t compare with an integer. Use `column("publishedAt").value(date)`, which writes it as the attribute stores it: see [Writing SQL fragments](./querying#writing-sql-fragments).
:::

::: warning TIP
Prisma’s dates need no override. On D1, Prisma writes a `DateTime` as ISO text, which d1-record reads as it is.
:::

::: rails Beyond Rails
Active Record has no option for a date kept as an integer; there it takes a custom attribute type. In d1-record it’s a `storage` on the `datetime`.
:::
