---
description: 'Reference for Models: ApplicationRecord("table") and overrides, declaring attributes yourself with Model({...}), table names, attributes and types, casting assigned values, building records, permit, timestamps, change tracking, SQL fragments, serialization and filtered attributes.'
---

# Models

A Model describes one table: its attributes, and its behavior. Usually its attributes come from your migrations, through the generated schema, and the Model declares only behavior.

## Declaring a Model

A Model extends your app's `ApplicationRecord`, naming its table. The table's attributes, primary key and types come from `src/db/schema.ts`, which [`d1-record schema`](./command-line#d1-record-schema) generates:

<<< @/snippets/guide/models.ts#generated{ts}

- **The table is the argument**, not inferred from the class name, so the Model doesn't depend on its class keeping its name when bundled. A table that isn't in the schema is a compile error.
- **Subclasses share it.** Setting another `tableName` on such a Model throws `InvalidModel`; `static primaryKey` can still be set, and must name an attribute.

### Overrides

The second argument changes how attributes are read and written, never the table. It's keyed by attribute name, and typed: an unknown name is a compile error.

| Override                     | Does                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| `"boolean"` (a type name)    | Reads and writes the attribute as that type                                                          |
| `{ type?, null?, default? }` | Replaces those parts of the generated attribute; `null: false` makes it non-null in TypeScript       |
| `false`                      | Ignores the column: it's never typed, read or written, and queries name their columns instead of `*` |

The column can't change, an attribute can't be added, and the primary key can't be ignored: each is an `InvalidModel`, even past a cast. Changing an attribute's `type` drops its generated default, which was for the old type, so the column's own default applies unless you give one. A `default` isn't type-checked against the attribute's type yet ([#74](https://github.com/forestfuture/d1-record/issues/74)), but one that returns a value the type can't cast throws `TypeError` when a record is built. An ignored `NOT NULL` column without a default makes inserts fail, so give it a default in a migration first.

## Declaring attributes yourself

For a view, or a table your migrations don't make, declare the attributes in the Model, with `Model({...})` or `ApplicationRecord({...})` (the same, with your base class's shared behavior). TypeScript infers the record's properties from the object:

<<< @/snippets/guide/models.ts#declare{ts}

An attribute is a type name, or `{ type, column?, null?, default? }`. The rest of this page applies to both ways of declaring a Model.

## Table names

A Model declared with `Model({...})` has its table named after its class, as Rails names it: the class name in snake_case, pluralized. `User` → `users`, `BlogPost` → `blog_posts`, `Category` → `categories`, `Person` → `people`, `Sheep` → `sheep`. A subclass shares its parent's table.

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

Store `json` attributes in a `TEXT` column, as [D1 recommends](https://developers.cloudflare.com/d1/sql-api/query-json/#types), and add `CHECK (json_valid(settings))` to have D1 reject anything that isn't valid JSON. A column declared `JSON` works too.

### Assigned values are cast

TypeScript can't check a value that comes from JSON, a form or a query string, so d1-record casts every value to its attribute's type when it's assigned: in `build`, `create`, `assign`, `update`, a property setter and a default; in the values given to `insert`, `insertAll`, `upsert`, `upsertAll` and `updateAll`; and in [`permit`](#picking-attributes-from-input-permit). `null` is always NULL. Only what's unambiguous is accepted:

| Type       | Accepts                                                                                                                                |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `boolean`  | `true`, `false`, `1`, `0`, `"1"`, `"0"`, and `"true"`, `"false"`, `"on"`, `"off"` in any case                                          |
| `integer`  | a safe integer, or a string that's wholly one, with an optional sign and spaces around it: `"42"`, `" -7 "`, `"+3"`                    |
| `real`     | a finite number, or a string that's wholly one, with an optional sign, point and exponent: `"1.5"`, `".5"`, `"5."`, `"-2e3"`           |
| `string`   | a string                                                                                                                               |
| `datetime` | a valid `Date`; a date, `"2026-01-02"` (midnight UTC); or a date and time with `Z` or a `±HH:MM` offset: `"2026-01-02T09:30:00+02:00"` |
| `json`     | any value                                                                                                                              |

Refused, among others: `""` for every type but `string`; `1.7`, `"12abc"`, `"1e3"` and integers past `Number.MAX_SAFE_INTEGER` for an `integer`; `NaN` and `Infinity`; a number, boolean or `Date` for a `string`; for a `datetime`, a time without an offset, a lowercase `t` or `z`, a day that doesn't exist (`"2026-02-30"`, with or without a time), other formats, and numbers.

Anything else throws `TypeError` naming the Model and the attribute, and the attribute keeps its value. The error shows at most 60 characters of the value, and none of a [filtered attribute](#filtered-attributes)'s:

<<< @/snippets/guide/models.ts#casting{ts}

Conditions are cast the same way, so `where({ quantity: "42" })` finds 42. A condition value that can't be cast matches nothing, so `find("abc")` on an integer key throws `RecordNotFound`. See [Querying](./querying#conditions). A condition also reads a number as its digits for a `string` attribute, and a record built from that Relation (`where({ label: 7 }).build()`) starts with what the condition matched, `"7"`. A key copied from another record through an association is cast the same way, so an integer key written into a text foreign key becomes its digits.

::: tip Beyond Rails
Rails casts too, but leniently: `"12abc"` becomes `12`, `1.7` becomes `1`, any other text is `true`, and `""` is `nil`. d1-record refuses each, so `isAdmin=no` from a form can't save `true`, and an empty field can't silently become `null`.
:::

## Building records

`build()` makes a new record without touching the database:

<<< @/snippets/guide/models.ts#build{ts}

- **Defaults** run at `build()`, so a key generated in code (a UUID, ULID or CUID) exists before the record is saved. That's what lets records that point at each other be saved together, in one atomic batch.
- **Unassigned attributes** read as `null`, and aren't written when the record is inserted, so the column's own database default applies. After the insert, the record loads what D1 actually stored, generated keys and defaults included.
- **Unknown attributes** throw `UnknownAttribute`, and an `undefined` value throws `TypeError`. Use `null` to store NULL.

`assign(attrs)` sets several attributes without saving. `update(attrs)` is `assign` then `save`.

Records also keep the database they were built or loaded through, for their later saves and association loads. A record made with `new User()` has none: build records with `User.build(…)`.

### Picking attributes from input: `permit`

`Model.permit(input, ...names)` keeps only the named attributes of untrusted input, as Rails' `params.permit`, and casts each value as assigning it would. Its result, `Partial<Pick<attributes, names>>`, goes straight into `build`, `create` or `update`. [Handle untrusted input](./untrusted-input) shows it in use.

| Input             | Read                                                             |
| ----------------- | ---------------------------------------------------------------- |
| a plain object    | its own keys only, so `__proto__` and inherited keys never count |
| `FormData`        | each field; a repeated key takes its last value                  |
| `URLSearchParams` | each parameter; a repeated key takes its last value              |

- **Keys it isn't given** are dropped, silently. A named attribute the input doesn't have is left out, and a `null` is kept.
- **A name that isn't an attribute** is a compile error, and throws `UnknownAttribute`.
- **`TypeError`** for a value that can't be cast, a file from a form (no attribute stores one), and input that's anything else: an array, a `Map`, `Headers`, a class instance, `null` or a string.
- It's a static, so subclasses and your app's base class have it.

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

## SQL fragments

Anything the query methods can't express is written as an `sql` tagged template, so values are always bound, never pasted into SQL. Fragments are SQL, so they name columns. `column("createdAt")` looks one up from its attribute, so a renamed column is changed in one place. A plain string is rejected.

## Serialization

`toJSON()` gives the record's attributes with dates as ISO strings, so `Response.json(user)` just works. `attributes()` gives the same object with JavaScript values. Associations are never included, so a response never loads more than you asked for.

<<< @/snippets/guide/models.ts#json{ts}

## Filtered attributes

`onQuery` listeners and error messages show a filtered attribute's values as `"[FILTERED]"`, as Rails' logs do. D1 still gets the real values. [Log queries](./logging#keep-secrets-out-of-the-logs) shows how to change the list.

- **Which attributes:** `static filterAttributes`, a list of strings and RegExps, inherited from your app's base class. It starts as Rails' default list: `passw`, `email`, `secret`, `token`, `_key`, `crypt`, `salt`, `certificate`, `otp`, `ssn`, `cvv`, `cvc`. Setting it replaces the list; `[]` filters nothing.
- **Matching:** a string matches when the attribute's snake_case name contains it, in any case: `passwordDigest` (`password_digest`) contains `passw`, and `apiKey` (`api_key`) contains `_key`. A RegExp matches the attribute or its snake_case name.
- **Hidden in `QueryEvent.params`:** the values bound for the attribute in inserts (in a multi-row insert's JSON, its column in every row), updates, `updateAll`, conditions, lists and comparisons, and a filtered primary key in a record's `UPDATE` and `DELETE`.
- **Hidden in errors:** a cast error's value, and a filtered primary key in `RecordNotFound`.
- **Not hidden:** values inside `sql` fragments, which have no attribute; and `toJSON()` and `attributes()`, which are your data, not logs.

## Inheritance and shared behavior

A subclass (`class Admin extends User`) inherits a copy of its parent's attributes, validations, callbacks, scopes and associations, and declaring more on the child never changes the parent. Single-table inheritance isn't supported.

To share methods, callbacks and scopes across every Model, write them on your app's base class: see [Share behavior across Models](./shared-behavior).

## Checked when first used

The first time a Model is used (its first query, or `db.model(X)`), d1-record checks its declaration and throws `InvalidModel` if something's wrong: no table name (an empty `tableName`, or a class with no name to infer one from), a `primaryKey` that isn't an attribute, an attribute named like a record method (`save`, `attributes`, …), or a class field that hides an attribute (such as `email!: string` in the class body). After that, a Model's declarations are fixed, so request code can never change them.
