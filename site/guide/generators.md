---
description: "Add a table with its Model, change a table, write columns, reference the same table, keep Models in another folder, and keep the generated schema current."
---

# Generators

d1-record’s generators write a table’s migration (and its Model) from a short description, then regenerate `src/db/schema.ts`. Every option and convention is in the [Command line](./command-line) reference.

## Add a table and its Model

Name the Model, and list its columns:

```sh
npx d1-record g model Product 'name:string!' 'priceCents:integer!=0' user:references
```

```
Wrote migrations/0003_create_products.sql
Wrote src/models/product.ts
Wrote src/db/schema.ts (3 tables) from migrations/
Next: npx wrangler d1 migrations apply my-app-db --local
```

Then apply the migration, to your local database now and the deployed one when you deploy:

```sh
npx wrangler d1 migrations apply my-app-db --local
```

The table is `products`, the plural of the Model’s name, and it gets an `id` generated in code plus `created_at` and `updated_at`. `--id integer` gives it a key D1 generates instead, and `--no-timestamps` leaves out the timestamps.

## Write columns

Each column is `name:type`, with optional marks after it:

| Column                 | Means                                                                            |
| ---------------------- | -------------------------------------------------------------------------------- |
| `title`                | A `string`, the default type                                                     |
| `email:string!:unique` | Required (`NOT NULL`), with a unique index                                       |
| `count:integer!=0`     | Required, with a default of `0`                                                  |
| `settings:json`        | JSON, checked by D1 (`CHECK (json_valid(settings))`)                             |
| `user:references`      | `user_id`, pointing at `users`, indexed; the Model gets `user = belongsTo(User)` |

Quote columns that contain `!` in bash or zsh. The [column syntax](./command-line#column-syntax) lists every type.

::: warning Beyond Rails
Rails’ generators have no syntax for a column’s default. d1-record adds `=value` (`=0`, `=true`, `=draft`), because SQLite can’t add a required (`NOT NULL`) column to an existing table without one.
:::

## Change a table

`g migration` reads what to do from the migration’s name:

```sh
npx d1-record g migration AddSlugToPosts slug:string:unique   # ADD COLUMN, with a unique index
npx d1-record g migration RemoveSlugFromPosts slug             # DROP COLUMN
npx d1-record g migration BackfillSlugs                         # an empty migration to write yourself
```

The name can be written `AddSlugToPosts` or `add_slug_to_posts`. Apply each migration afterwards, as above.

A required column added without a default is refused, before anything is written, since SQLite can’t add one: give it a default (`slug:string!=draft`), or leave out the `!`.

::: warning A default and a unique index don’t mix on a table with rows
`g migration AddSlugToPosts 'slug:string!=draft:unique'` is accepted, but applying it to a table with more than one row fails: every row gets `draft`, which the unique index refuses. Add the column without the index, fill it in, then add the index in a later migration.
:::

## Reference the same table

`g model Category parent:references` points `parent_id` at a `parents` table and writes `parent = belongsTo(Parent)`, since it can’t know the parent is another category. Edit both files before applying the migration:

1. In the migration, point the column at `categories`, and make it optional, since top-level categories have no parent:

   ```sql
   parent_id TEXT REFERENCES categories (id),
   ```

2. In the Model, use `Category` itself, and add the other direction if you want it.

<<< @/snippets/guide/generators.ts#self-reference{ts}

::: warning Compared with Rails
Rails writes `belongs_to :parent, class_name: "Category", optional: true`. Here the association takes the class itself, so there’s no `class_name`, and whether a parent is required comes from the column: `parentId` can be `null` because the migration allows it.
:::

## Keep Models in another folder

By default, Models and `application-record.ts` go in `src/models/`. To keep them elsewhere, pass `--models` to every command:

```sh
npx d1-record schema --models src/app/models
npx d1-record g model Product 'name:string!' --models src/app/models
```

::: tip Pass `--models` every time
Both commands take it, and both need it: `d1-record schema` writes `application-record.ts` there, and the generators write Models there, importing it. A script in `package.json` saves retyping it: `"db:schema": "d1-record schema --models src/app/models"`.
:::

## Keep the schema current

The generators regenerate `src/db/schema.ts` themselves. After writing or editing a migration by hand, regenerate it:

```sh
npx d1-record schema
```

While you work on migrations, `npx d1-record schema --watch` regenerates it on every change. In CI, `npx d1-record schema --check` fails when the committed schema is out of date.
