---
description: "Declaring a Model: attributes and types, camelCase to snake_case columns, defaults, timestamps, change tracking, scopes, serialization and inheritance."
---

# Models

A Model describes one table. You declare its attributes once, in the object passed to `Model({...})`, and TypeScript infers the record's properties from it.

<<< @/snippets/guide/models.ts#declare{ts}

## Table names

A Model's table is named after its class, as Rails names it: the class name in snake_case, pluralized. `User` → `users`, `BlogPost` → `blog_posts`, `Category` → `categories`, `Person` → `people`, `Sheep` → `sheep`. A subclass shares its parent's table.

The rules are Rails' own English ones, quirks included: `Human` becomes `humen`, as `man` becomes `men`, and `Leaf` becomes `leafs`. When a table is named differently, say so with `static tableName = "billing_accounts"`. There's no way to add your own pluralization rules: name the table instead.

A class with no name to infer from, such as an anonymous class or `export default class extends Model(...)`, must set `static tableName`.

::: details Bundlers and class names
The table name comes from the class's name, so the class has to keep its name when your Worker is bundled. Wrangler keeps names by default, even when minifying. If a bundler renames `User` to something like `e`, the first query to its table throws `InvalidModel`, saying the table `es` doesn't exist and that its name was inferred from the class name. Set `static tableName`, or keep class names in your bundler's settings.
:::

## Attributes and columns

Attributes are camelCase in your code and map to snake_case columns, by Rails' `underscore` rule:

| Attribute           | Column                |
| ------------------- | --------------------- |
| `createdAt`         | `created_at`          |
| `externalAccountId` | `external_account_id` |
| `htmlURL`           | `html_url`            |
| `userID`            | `user_id`             |
| `sha256Hash`        | `sha256_hash`         |

`{ column: "..." }` maps one attribute to a column with another name. Everywhere outside SQL fragments (conditions, ordering, association keys), you name attributes, never columns.

## Types

An attribute is a type name, or `{ type, column?, null?, default? }`.

| Type       | JavaScript | Stored in D1 as       |
| ---------- | ---------- | --------------------- |
| `string`   | `string`   | `TEXT`                |
| `integer`  | `number`   | `INTEGER`             |
| `real`     | `number`   | `REAL`                |
| `boolean`  | `boolean`  | `INTEGER`, `0` or `1` |
| `datetime` | `Date`     | `TEXT`, ISO-8601      |
| `json`     | any value  | `TEXT`, as JSON       |

As in SQLite, an attribute can be `null` unless it's declared `null: false`, and its TypeScript type includes `| null` to match.

## Building records

`build()` makes a new record without touching the database:

<<< @/snippets/guide/models.ts#build{ts}

- **Defaults** run at `build()`, so a key generated in code (a UUID, ULID or CUID) exists before the record is saved. That's what lets records that point at each other be saved together, in one atomic batch.
- **Unassigned attributes** read as `null`, and aren't written when the record is inserted, so the column's own database default applies. After the insert, the record loads what D1 actually stored, generated keys and defaults included.
- **Unknown attributes** throw `UnknownAttribute`, and an `undefined` value throws `TypeError`. Use `null` to store NULL.

`assign(attrs)` sets several attributes without saving. `update(attrs)` is `assign` then `save`.

## Timestamps

Declare `createdAt` and `updatedAt` as `datetime` attributes and they're managed for you: both are set when a record is created, and `updatedAt` whenever a save changes something. A save with nothing to change leaves `updatedAt` alone, and a timestamp you assign yourself is kept.

## Change tracking

Records know what's changed since they were loaded or last saved, as in Rails:

<<< @/snippets/guide/models.ts#dirty{ts}

- `isChanged()`, `changed()`, `changedAttributes()` and `changes()` describe the unsaved changes.
- `attributeWas`, `isAttributeChanged` and `willSaveChangeTo` look at one attribute's unsaved change: use them in before-callbacks.
- `savedChanges()`, `savedChangeTo`, `hasSavedChangeTo` and `attributeBeforeLastSave` look at the last successful save: use them in after-callbacks, where the record is already clean.
- `restoreAttributes()` undoes unsaved changes, to all attributes or the ones you name.

Changes are found by comparing stored values, so editing a `json` value or a `Date` in place counts as a change. An update writes only the attributes that changed, and a save with nothing changed sends nothing.

## Scopes

Scopes are named, reusable parts of a query. A scope receives the current Relation, plus any arguments, and returns a narrower one:

<<< @/snippets/guide/models.ts#scopes{ts}

Scopes are typed, chain with everything else, and never query on their own. Their arguments, and anything they compute such as `new Date()`, are evaluated when you call them, not when the class is defined.

A scope can't reuse a name a Relation already has, like `where` or `count`. Inside a scope, `q` has every Relation method but not the Model's other scopes, so share logic between scopes with a plain function.

## SQL fragments

Anything the query methods can't express is written as an `sql` tagged template, so values are always bound, never pasted into SQL. Fragments are SQL, so they name columns. `column("createdAt")` looks one up from its attribute, so a renamed column is changed in one place. A plain string is rejected.

## Serialization

`toJSON()` gives the record's attributes with dates as ISO strings, so `Response.json(user)` just works. `attributes()` gives the same object with JavaScript values. Associations are never included, so a response never loads more than you asked for.

<<< @/snippets/guide/models.ts#json{ts}

## Inheritance and shared behavior

A subclass (`class Admin extends User`) inherits a copy of its parent's attributes, validations, callbacks, scopes and associations, and declaring more on the child never changes the parent. Single-table inheritance isn't supported.

To share behavior between Models, write a plain function and call it from each Model's `static {}` block, rather than building an app-wide base class:

<<< @/snippets/guide/models.ts#shared{ts}

## Checked when first used

The first time a Model is used, `db.model(X)` checks its declaration and throws `InvalidModel` if something's wrong: no table name (an empty `tableName`, or a class with no name to infer one from), a `primaryKey` that isn't an attribute, an attribute named like a record method (`save`, `attributes`, …), or a class field that hides an attribute (such as `email!: string` in the class body). After that, a Model's declarations are fixed, so request code can never change them.
