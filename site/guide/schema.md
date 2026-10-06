---
description: 'Why d1-record generates a Model''s attributes from your migrations, how the generated schema compares to Rails'' schema.rb, and why Models extend your app''s ApplicationRecord("table").'
---

# Schema and `ApplicationRecord`

In Rails, a migration describes a table, and the model never repeats it: Active Record reads the columns from the database when the app runs. d1-record keeps that idea, with one change TypeScript requires: it reads the columns when you **generate** the schema, not when your Worker runs.

## Migrations are the source of truth

Tables are created and changed by **migrations**: numbered SQL files that Wrangler applies in order, recording each one in the database (in a `d1_migrations` table), so each runs once. Cloudflare’s [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/) guide covers Wrangler’s side. d1-record’s generators write migrations for you, but any migration Wrangler can apply works, however it was written.

A Model never redeclares its columns. If it did, the migration and the Model would say the same thing twice (`price_cents INTEGER NOT NULL`, then `priceCents: { type: "integer", null: false }`), and could drift apart.

## The generated schema

TypeScript needs to know a Model’s attributes before your code runs, to type `product.priceCents` and check `Product.where({ … })`. And a Worker shouldn’t ask D1 for its tables on every request. So instead of reading the database at runtime, `d1-record schema` applies your migrations to an in-memory SQLite database, reads each table’s columns, and writes them to `src/db/schema.ts`.

That file is to d1-record what `db/schema.rb` is to Rails: a document of every table, regenerated after each migration, never edited by hand, and committed, so each schema change shows up as a readable diff next to its migration. Each table names the migration that last changed it. In CI, `d1-record schema --check` catches a schema someone forgot to regenerate.

Columns become attributes by convention, as Rails’ do: the column’s declared type first (`INTEGER` is an `integer`, `DATETIME` a `datetime`), then, for plain `TEXT` and `INTEGER` columns, its name (`created_at` is a `datetime`). The [Command line](./command-line#conventions) reference lists every rule. When a column’s type isn’t what your app means (JSON in a plain `TEXT` column, say), an override in the Model says so, without touching the table.

## Why `ApplicationRecord("table")`

A Model extends your app’s base class, naming its table:

```ts
export class Product extends ApplicationRecord("products") {}
```

This is Rails’ shape: `class Product < ApplicationRecord`. The table is in the call because TypeScript can’t derive a class’s types from its name: `ApplicationRecord("products")` is what gives `Product` the `products` table’s attributes. As a bonus, the table doesn’t depend on the class keeping its name when your Worker is bundled.

`ApplicationRecord` itself is a file in your app, `src/models/application-record.ts`, which `d1-record schema` writes once. It builds the base class from the generated schema, `modelFor(tables, Base)`, and its `Base` is where behavior shared by every Model goes, as on Rails’ `ApplicationRecord`. Only that file imports the schema, so the schema stays a document.

A Model can still declare its attributes itself, with `Model({...})`, for a view or a table your migrations don’t make. See [Models](./models#declaring-attributes-yourself).
