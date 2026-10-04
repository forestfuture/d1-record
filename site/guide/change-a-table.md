---
description: "Add, rename and remove columns with migrations, deploy them in the right order, and change a column's type by rebuilding the table."
---

# Change a table

A table changes through a new migration: Wrangler applies each one once, in order, and records it in the database. After each change, `src/db/schema.ts` is regenerated, so the Model's attributes follow the table with no edits to the Model.

## Add a column

Generate the migration, then apply it:

```sh
npx d1-record g migration AddBioToUsers bio:string
npx wrangler d1 migrations apply my-app-db --local
```

```sql [migrations/0003_add_bio_to_users.sql]
ALTER TABLE users ADD COLUMN bio TEXT;
```

`user.bio` is there straight away, typed as `string | null`. A required column needs a default, since the table's existing rows need a value: `'role:string!=member'`.

**Deploy in this order:** apply the migration with `--remote` first, then deploy the code that uses the column. Code deployed before the column existed keeps working, since d1-record only writes the attributes a Model has.

## Rename a column

There's no generator for a rename. Generate an empty migration and write it:

```sh
npx d1-record g migration RenameBioToAbout
```

```sql [migrations/0004_rename_bio_to_about.sql]
ALTER TABLE users RENAME COLUMN bio TO about;
```

The attribute follows the column: `bio` becomes `about`. Update the code that uses it, then apply the migration and deploy together, since the old code reads a column that's gone. (Keeping the old attribute name for a renamed column is [#65](https://github.com/forestfuture/d1-record/issues/65).)

## Remove a column

Work in the opposite order to adding one: the code stops using the column before the column goes.

1. Ignore the column in the Model, remove the code that uses it, and deploy:

   ```ts
   export class User extends ApplicationRecord("users", { bio: false }) {}
   ```

2. Generate the migration, and apply it with `--remote`:

   ```sh
   npx d1-record g migration RemoveBioFromUsers bio
   ```

3. Remove `{ bio: false }`, now that the schema no longer has the column.

A `references` column is removed the same way (`RemoveUserFromPosts user:references`): its index is dropped first, then the column.

## Change a column's type

SQLite can't change a column's type in place. Write a migration that builds the new table, copies the rows, and swaps the tables, as [SQLite describes](https://www.sqlite.org/lang_altertable.html#otheralter):

```sql [migrations/0005_make_price_cents_an_integer.sql]
PRAGMA defer_foreign_keys = true;

CREATE TABLE products_new (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);
INSERT INTO products_new SELECT id, name, CAST(price_cents AS INTEGER), created_at, updated_at FROM products;
DROP TABLE products;
ALTER TABLE products_new RENAME TO products;
```

`PRAGMA defer_foreign_keys = true` lets the swap happen while other tables point at this one, [as Cloudflare recommends](https://developers.cloudflare.com/d1/reference/migrations/). Recreate the table's indexes after the swap. Then regenerate the schema with `npx d1-record schema`, since the generators didn't write this migration.

Wrangler backs up the database before applying migrations to it.
