---
description: 'Reference for Models: ApplicationRecord("table") and overrides, declaring attributes yourself with Model({...}), table names, attributes and types, casting assigned values, building records, permit, timestamps, change tracking, SQL fragments, serialization, and filtered attributes.'
---

# Models

A Model describes one table. Its attributes come from your migrations, through the generated schema, so the Model only declares behavior.

## Defining Models

Extend your app’s `ApplicationRecord`, naming the table:

<<< @/snippets/guide/models.ts#generated{ts}

The table’s attributes, primary key, and types come from `src/db/schema.ts`, which [`d1-record schema`](./command-line#d1-record-schema) generates. A table that isn’t in the schema is a compile error.

::: warning TIP
The table is an argument, rather than inferred from the class name, so a Model keeps working when a bundler renames its class.
:::

Subclasses share the table: setting another `tableName` throws `InvalidModel`. You can still set `static primaryKey`, as long as it names an attribute.

### Overriding attributes

The second argument changes how attributes are read and written. It’s keyed by attribute name, so an unknown name is a compile error:

| Override                     | Does                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `"boolean"` (a type name)    | Reads and writes the attribute as that type                                                           |
| `{ type?, null?, default? }` | Replaces those parts of the generated attribute; `null: false` makes it non-null in TypeScript        |
| `false`                      | Ignores the column: it’s never typed, read, or written, and queries name their columns instead of `*` |

An override can’t change a column, add an attribute, or ignore the primary key: each throws `InvalidModel`.

- **Changing a `type`** drops the generated default, so the column’s own default applies unless you give one.
- **A `default`** isn’t type-checked yet ([#74](https://github.com/forestfuture/d1-record/issues/74)). One that returns a value the type can’t cast throws `TypeError` when a record is built.
- **Ignoring a `NOT NULL` column** without a default makes inserts fail, so give it a default in a migration first.

## Declaring attributes yourself

For a view, or a table your migrations don’t make, declare the attributes with `Model({...})`. TypeScript infers the record’s properties from the object:

<<< @/snippets/guide/models.ts#declare{ts}

An attribute is a type name, or `{ type, column?, null?, default? }`. `ApplicationRecord({...})` does the same, with your base class’s shared behavior.

## Naming tables

A Model declared with `Model({...})` takes its table name from its class: snake_case, pluralized.

| Class      | Table        |
| ---------- | ------------ |
| `User`     | `users`      |
| `BlogPost` | `blog_posts` |
| `Category` | `categories` |
| `Person`   | `people`     |
| `Sheep`    | `sheep`      |

To use another name, set `static tableName`:

```ts
export class Account extends Model({ id: "string" }) {
  static tableName = "billing_accounts";
}
```

A subclass shares its parent’s table. An anonymous class, such as `export default class extends Model(...)`, must set `static tableName`.

::: warning TIP
Pluralization follows English rules, quirks included: `Human` becomes `humen` and `Leaf` becomes `leafs`. There’s no way to add your own rules, so set `tableName` instead.
:::

::: details Bundlers and class names
Wrangler keeps class names by default, even when minifying. If a bundler renames `User` to `e`, the first query throws `InvalidModel`, saying the table `es` doesn’t exist and that its name was inferred from the class name. Set `static tableName`, or keep class names in your bundler’s settings.
:::

## Mapping columns

Attributes are camelCase, and map to snake_case columns:

| Attribute           | Column                |
| ------------------- | --------------------- |
| `createdAt`         | `created_at`          |
| `externalAccountId` | `external_account_id` |
| `htmlURL`           | `html_url`            |
| `userID`            | `user_id`             |
| `sha256Hash`        | `sha256_hash`         |

To map an attribute to a column with another name, give it `{ column: "..." }`. Conditions, ordering, and association keys always name attributes; only SQL fragments name columns.

## Attribute types

| Type       | JavaScript | Stored in D1 as       |
| ---------- | ---------- | --------------------- |
| `string`   | `string`   | `TEXT`                |
| `integer`  | `number`   | `INTEGER`             |
| `real`     | `number`   | `REAL`                |
| `boolean`  | `boolean`  | `INTEGER`, `0` or `1` |
| `datetime` | `Date`     | `TEXT`, ISO-8601      |
| `json`     | any value  | `TEXT`, as JSON       |

An attribute can be `null` unless it’s declared `null: false`, and its TypeScript type includes `| null` to match.

::: warning TIP
Store `json` attributes in a `TEXT` column, as [D1 recommends](https://developers.cloudflare.com/d1/sql-api/query-json/#types), and add `CHECK (json_valid(settings))` to have D1 reject invalid JSON. A column declared `JSON` works too.
:::

## Casting assigned values

Every value is cast to its attribute’s type when it’s assigned, so text from JSON, a form, or a query string becomes the right type:

<<< @/snippets/guide/models.ts#casting{ts}

Values are cast wherever they’re assigned: `build`, `create`, `assign`, `update`, a property setter, a default, [`permit`](#permitting-fields), and the values given to `insert`, `insertAll`, `upsert`, `upsertAll`, and `updateAll`. `null` is always NULL. Only unambiguous values are accepted:

| Type       | Accepts                                                                                                                                |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `boolean`  | `true`, `false`, `1`, `0`, `"1"`, `"0"`, and `"true"`, `"false"`, `"on"`, `"off"` in any case                                          |
| `integer`  | a safe integer, or a string that’s wholly one, with an optional sign and spaces around it: `"42"`, `" -7 "`, `"+3"`                    |
| `real`     | a finite number, or a string that’s wholly one, with an optional sign, point, and exponent: `"1.5"`, `".5"`, `"5."`, `"-2e3"`          |
| `string`   | a string                                                                                                                               |
| `datetime` | a valid `Date`; a date, `"2026-01-02"` (midnight UTC); or a date and time with `Z` or a `±HH:MM` offset: `"2026-01-02T09:30:00+02:00"` |
| `json`     | any value                                                                                                                              |

Anything else throws `TypeError` naming the Model and the attribute, and the attribute keeps its value. The error shows at most 60 characters of the value, and none of a [filtered attribute](#filtering-attributes)’s. Among the values refused:

- `""` for every type but `string`.
- `1.7`, `"12abc"`, `"1e3"`, and integers past `Number.MAX_SAFE_INTEGER`, for an `integer`.
- `NaN` and `Infinity`.
- A number, boolean, or `Date` for a `string`.
- For a `datetime`: a time without an offset, a lowercase `t` or `z`, a day that doesn’t exist (`"2026-02-30"`), other formats, and numbers.

### Casting conditions and keys

Conditions are cast the same way, so `where({ quantity: "42" })` finds 42. A condition value that can’t be cast matches nothing, so `find("abc")` on an integer key throws `RecordNotFound`.

- A condition reads a number as its digits for a `string` attribute, and a record built from that Relation starts with what it matched: `where({ label: 7 }).build()` has the label `"7"`.
- A key copied from another record through an association is cast too, so an integer key written into a text foreign key becomes its digits.

::: warning Beyond Rails
Rails casts leniently: `"12abc"` becomes `12`, `1.7` becomes `1`, any other text is `true`, and `""` is `nil`. d1-record refuses each, so `isAdmin=no` from a form can’t save `true`, and an empty field can’t silently become `null`.
:::

## Building records

Build a record without touching the database with `build`:

<<< @/snippets/guide/models.ts#build{ts}

- **Defaults** run at `build()`, so a key generated in code exists before the record is saved. That lets records that point at each other be saved together, in one atomic batch.
- **Unassigned attributes** read as `null`, and aren’t written on insert, so the column’s database default applies. After the insert, the record loads what D1 stored.
- **Unknown attributes** throw `UnknownAttribute`, and `undefined` throws `TypeError`. Use `null` to store NULL.

`assign(attrs)` sets several attributes without saving. `update(attrs)` assigns, then saves.

::: warning TIP
A record keeps the database it was built or loaded through, for its later saves and association loads. A record made with `new User()` has none, so build records with `User.build(…)`.
:::

### Permitting fields

Keep only the attributes you name from untrusted input with `permit`. It casts each value as assigning would, and its result goes straight into `build`, `create`, or `update`:

```ts
const permitted = Account.permit(await request.json(), "email", "handle");
const account = await Account.create(permitted);
```

It reads three kinds of input:

| Input             | Read                                                             |
| ----------------- | ---------------------------------------------------------------- |
| a plain object    | its own keys only, so `__proto__` and inherited keys never count |
| `FormData`        | each field; a repeated key takes its last value                  |
| `URLSearchParams` | each parameter; a repeated key takes its last value              |

- **Keys you don’t name** are dropped. A named attribute the input doesn’t have is left out, and a `null` is kept.
- **A name that isn’t an attribute** is a compile error, and throws `UnknownAttribute`.
- **`TypeError`** is thrown for a value that can’t be cast, a file from a form, and any other input: an array, a `Map`, `Headers`, a class instance, `null`, or a string.

[Untrusted input](./untrusted-input) shows `permit` in a Worker.

## Using timestamps

Declare `createdAt` and `updatedAt` as `datetime` attributes, and they’re managed for you. Both are set when a record is created, and `updatedAt` whenever a save changes something. A save with nothing to change leaves `updatedAt` alone, and a timestamp you assign yourself is kept.

## Tracking changes

Records know what’s changed since they were loaded or last saved:

<<< @/snippets/guide/models.ts#dirty{ts}

- `isChanged()`, `changed()`, `changedAttributes()`, and `changes()` describe the unsaved changes.
- `attributeWas`, `isAttributeChanged`, and `willSaveChangeTo` look at one attribute’s unsaved change. Use them in before-callbacks.
- `savedChanges()`, `savedChangeTo`, `hasSavedChangeTo`, and `attributeBeforeLastSave` look at the last save. Use them in after-callbacks, where the record is already clean.
- `restoreAttributes()` undoes unsaved changes, to every attribute or the ones you name.

An update writes only the attributes that changed, and a save with nothing changed sends nothing.

::: warning TIP
Changes are found by comparing stored values, so editing a `json` value or a `Date` in place counts as a change.
:::

## Writing SQL fragments

For anything the query methods can’t express, write an `sql` tagged template. Values are always bound, and `column()` looks up an attribute’s column:

```ts
const recent = await User.where(sql`${column("createdAt")} > ${since}`).toArray();
```

A plain string is rejected.

## Serializing records

`toJSON()` gives a record’s attributes with dates as ISO strings, so `Response.json(user)` just works. `attributes()` gives the same object with JavaScript values:

<<< @/snippets/guide/models.ts#json{ts}

Associations are never included, so a response never loads more than you asked for.

## Filtering attributes

`onQuery` listeners and error messages show a filtered attribute’s values as `"[FILTERED]"`. D1 still gets the real values. [Logging](./logging#keep-secrets-out-of-the-logs) shows how to change the list.

- **Which attributes:** `static filterAttributes`, a list of strings and RegExps, inherited from your app’s base class. By default, it’s `passw`, `email`, `secret`, `token`, `_key`, `crypt`, `salt`, `certificate`, `otp`, `ssn`, `cvv`, `cvc`. Setting it replaces the list; `[]` filters nothing.
- **Matching:** a string matches when the attribute’s snake_case name contains it, in any case: `passwordDigest` (`password_digest`) contains `passw`, and `apiKey` (`api_key`) contains `_key`. A RegExp matches the attribute or its snake_case name.
- **Hidden in `QueryEvent.params`:** the values bound for the attribute in inserts (in a multi-row insert’s JSON, its column in every row), updates, `updateAll`, conditions, lists and comparisons, and a filtered primary key in a record’s `UPDATE` and `DELETE`.
- **Hidden in errors:** a cast error’s value, and a filtered primary key in `RecordNotFound`.
- **Not hidden:** values inside `sql` fragments, which have no attribute; and `toJSON()` and `attributes()`, which are your data, not logs.

::: warning Compared with Rails
The default list is Rails’ own `filter_parameters` list, and the filtered values read as they do in Rails’ logs.
:::

## Sharing behavior

A subclass, such as `class Admin extends User`, inherits a copy of its parent’s attributes, validations, callbacks, scopes, and associations. Declaring more on the child never changes the parent. Single-table inheritance isn’t supported.

To share methods, callbacks, and scopes across every Model, write them on your app’s base class. See [Shared behavior](./shared-behavior).

## Checking declarations

The first time a Model is used, by its first query or `db.model(X)`, its declaration is checked. It throws `InvalidModel` for:

- No table name: an empty `tableName`, or a class with no name to infer one from.
- A `primaryKey` that isn’t an attribute.
- An attribute named like a record method, such as `save` or `attributes`.
- A class field that hides an attribute, such as `email!: string` in the class body.

After that, a Model’s declarations are fixed, so request code can’t change them.
