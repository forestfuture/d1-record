---
description: "Reference for querying: a Model's statics, Relations, where and comparisons, sql fragments, ordering and paging, paginate, find/findBy/first/count, partial records, none(), merge, scopes, and preloading."
---

# Querying

A query is a **Relation**. Each method that narrows, orders, or pages it returns a new Relation, and nothing runs until you ask for results:

<<< @/snippets/guide/querying.ts#relation{ts}

::: warning TIP
Relations have no `then`, so an `async` function that returns one never runs it by accident. Ask for results with a method such as `toArray()`, `first()`, or `count()`.
:::

## Starting a query

Every Relation method is also a static of every Model: `User.where(…)`, `User.find(id)`, `User.count()`, `User.create(…)`. `User.all()` is the Relation itself, and scopes are statics too: `User.active()`.

A query runs on the current database: the request’s, if it was opened with `withDatabase`, or the Model’s binding. To use another, start from `db.model(User)`. See [Connections](./connecting).

## Adding conditions

Pass `where` an object of attributes that must all match:

<<< @/snippets/guide/querying.ts#where{ts}

- `null` matches NULL, and an array matches any of its values. The list is bound as one value, so it can be any length.
- `whereNot` negates the whole condition. As in SQL, `whereNot({ role: "admin" })` also leaves out users whose role is NULL.
- `or` combines two Relations of the same Model that differ only in their conditions.
- `undefined` throws `TypeError`. Leave the key out, or use `null`.

Values are [cast to the attribute’s type](./models#casting-assigned-values), so `where({ quantity: "42" })` finds 42. A value that can’t be cast matches nothing: `findBy` resolves to `null`, and `find` throws `RecordNotFound`.

::: warning TIP
In a list, values that can’t be cast are left out. So `whereNot({ id: "abc" })` on an integer key excludes nothing.
:::

### Comparing values

Pass a comparison helper as a value:

<<< @/snippets/guide/querying.ts#comparisons{ts}

`gt`, `gte`, `lt`, `lte`, and `between` work on number, string, and datetime attributes, and dates compare by time. `between` includes both ends. Pass `{ excludeEnd: true }` to leave out the end.

### Writing SQL fragments

For anything else, write an `sql` tagged template. Values are always bound, and `column()` looks up an attribute’s column:

<<< @/snippets/guide/querying.ts#sql{ts}

::: warning Integer datetimes
A value in a fragment is bound as it is, so a `Date` is ISO text. If the attribute is a datetime [stored as a Unix time](./adopt-a-database#reading-unix-timestamps), compare it with `column("publishedAt").value(date)`, which writes the `Date` as the attribute stores it. A bare `Date` (or an ISO datetime string) beside that column in a comparison throws `TypeError`. In an expression, such as `abs(${column("publishedAt")} - ${date})`, or in an `IN` list, d1-record can’t tell what you meant: you’re comparing an integer with text, which SQLite always orders the same way, so `>` matches nothing and `<` matches every row. Check which form the expression needs, and use `value` when it needs the stored one.
:::

<<< @/snippets/guide/adopt.ts#fragment{ts}

`value` works for any attribute, and writes a boolean as 0 or 1 and a JSON value as text. The value is cast as an assigned one, so a value the attribute can’t hold throws `TypeError` naming the attribute, when `where` is given the fragment. A filtered attribute’s value is hidden from `onQuery`, as it is anywhere else.

## Using raw statements

Bind what `serialize` gives when you send SQL to D1 yourself. `typeForAttribute` returns an attribute’s conversions:

<<< @/snippets/guide/raw-statements.ts#bind{ts}

`serialize` writes the `Date` as `paidAt` stores it: an integer here, ISO text for a plain `datetime`.

Turn a cell from a raw query into the attribute’s value with `deserialize`:

<<< @/snippets/guide/raw-statements.ts#read{ts}

For a cache key, or the value a test expects of a raw row, `serialize` gives the stored form too.

`cast` gives the JavaScript value for an input, without converting it to the stored form: `cast("2026-01-02")` is a `Date`. It keeps a `Date`’s milliseconds, where `serialize` floors them for `unixSeconds`.

- **`serialize` and `cast`** take what assigning would: a `Date` or an ISO string for a `datetime`, `"42"` for an `integer`. Anything else throws `TypeError` naming the Model and attribute, and so does `undefined`. Use `null` for NULL.
- **`deserialize`** reads a cell as loading a record does, and NULL and `undefined` are `null`. It throws the same `TypeError` for a cell that isn’t the attribute’s type. See [Fixing cells of the wrong type](./adopt-a-database#fixing-cells-of-the-wrong-type).
- **A filtered attribute’s value** is hidden in those errors, as it is anywhere else.

::: warning TIP
`typeForAttribute` needs no connection to D1, and the attribute’s name is checked when you compile.
:::

::: rails Compared with Rails
`typeForAttribute` is `type_for_attribute`, with the same `cast`, `serialize`, and `deserialize`. d1-record’s are strict: a value the attribute can’t hold throws, where Rails casts it leniently.
:::

## Ordering and paging

Sort by each key in turn with `order`, and page with `limit` and `offset`:

<<< @/snippets/guide/querying.ts#order{ts}

Calling `order` again adds more keys. `reorder` replaces the order so far, and `reorder()` removes it. To get a page with its total, use [`paginate`](#paginating).

::: warning TIP
NULLs sort first in ascending order, as in SQLite. Place them with `nulls: "first"` or `nulls: "last"`.
:::

## Paginating

`paginate` resolves to one page of records and the total they’re a page of, in a single round trip to D1:

<<< @/snippets/guide/paginating.ts#paginate{ts}

- `page` and `perPage` take numbers, or text from a query string. Missing, `null`, or empty, they mean the first page and the default size. Anything that isn’t a whole number from 1 throws `TypeError`.
- Pages sort by the Relation’s order, then by the primary key, so records that tie keep their pages between requests.
- A page past the last has no records, but still has the real `total`.
- `includes()` preloads the page’s associations in the same round trip: one more query per association.
- A Relation with its own `limit` or `offset` throws `IncompatibleRelation`.

### Skipping the count

Counting reads every matching row, and D1 bills each row it reads. If you only need to know whether there’s a next page, pass `count: false`:

<<< @/snippets/guide/paginating.ts#countless{ts}

The page then has no `total` or `totalPages`.

### Setting the page size

By default, a page holds 25 records, and none holds more than 100. To change both, set `perPage` and `maxPerPage` on your app’s base class:

<<< @/snippets/guide/paginating.ts#per-page{ts}

::: warning TIP
D1 limits neither the rows a query returns nor the size of its response. `maxPerPage` keeps one request from reading, and paying for, too many rows, within a Worker’s 128 MB of memory and a query’s 30 seconds.
:::

::: rails Beyond Rails
Rails leaves pagination to gems such as Kaminari and Pagy. d1-record builds it in, and sends the count and the page to D1 together.
:::

## Getting results

Run a query with one of these methods:

<<< @/snippets/guide/querying.ts#terminal{ts}

- `find` throws `RecordNotFound` if the id is missing. Given several ids, it returns them in order, from one query, and throws if any are missing.
- `findBy` resolves to `null` when nothing matches, and `findByOrThrow` throws `RecordNotFound`.
- `first` and `last` sort by the primary key unless the Relation has an order, and `last` reverses that order. An `sql` fragment can’t be reversed, so `last` throws `IrreversibleOrder` there.
- `count()` always agrees with what `toArray()` returns, even with `limit`, `offset`, or `distinct`.
- `size()`, `isEmpty()`, and `hasAny()` count records, or check for any. On a loaded association, they answer without a query.

::: tip
`exists()`, `isEmpty()`, and `hasAny()` ignore the Relation’s order, so D1 stops at the first matching row. `count()` ignores it too, unless a `limit` or `offset` needs it. D1 bills each row it reads, so checks and counts stay cheap on an ordered Relation, such as an ordered association.
:::

::: rails Compared with Rails
`size()`, `isEmpty()`, and `hasAny()` are Rails’ `size`, `empty?`, and `any?`.
:::

## Selecting attributes

Load only some attributes with `select`. The primary key is always loaded too, so the records can still be saved:

<<< @/snippets/guide/querying.ts#select{ts}

- Reading an attribute that wasn’t loaded throws `MissingAttribute`, including from a validator or callback.
- Saving a partial record writes only what changed. `reload()` loads the whole row.
- After `distinct()`, the primary key isn’t added, since it would make every row distinct, so those records can’t be saved.

## Matching nothing

`none()` matches nothing without asking D1, so it needs no database to answer. Chaining more onto it keeps it empty:

<<< @/snippets/guide/querying.ts#none{ts}

## Seeing a query’s SQL

See the SQL a Relation’s `toArray()` would send, without sending it, with `toSql()`:

<<< @/snippets/guide/querying.ts#to-sql{ts}

The values come back in `params`, apart from the SQL.

A Statement from `toInsert`, `toUpdateAll`, `toDeleteAll`, and the other `to…` methods has `toSql()` too. A `none()` Relation shows `1 = 0`, the condition that matches nothing.

::: warning TIP
`toSql()` returns the real values, filtered attributes included. To see what a query sent, with those filtered, use [`onQuery`](./logging).
:::

A record’s `toSave()` and `toDestroy()` have no `toSql()`. Their SQL depends on validations and callbacks that only run inside `db.batch`.

::: rails Compared with Rails
`toSql()` is Rails’ `to_sql`, except that Rails writes the values into the SQL and `toSql()` keeps them in `params`.
:::

## Defining scopes

A scope is a named, reusable part of a query. Declare one as a static that receives the Relation, plus any arguments, and returns a narrower one:

<<< @/snippets/guide/models.ts#declare{ts}

Call it as a static, or on any Relation of the Model:

<<< @/snippets/guide/models.ts#scopes{ts}

- A scope’s arguments, and anything it computes such as `new Date()`, are evaluated when you call it.
- Scopes are inherited, including those on your app’s base class ([Shared behavior](./shared-behavior)). A subclass can replace one with `static override active = this.scope(…)`.
- A scope can’t reuse a Relation method’s name (`where`, `count`) or a Model static’s (`validates`, `scope`, `all`).
- Inside a scope, `q` has every Relation method but not the Model’s other scopes. Share logic between scopes with a plain function.

::: warning TIP
A scope whose body names its own class needs its type written out: `static roots: ScopeStatic<[]> = this.scope(…)`.
:::

## Merging Relations

Combine two Relations of the same Model with `merge`. Their conditions are joined with AND, and anything the argument sets, such as an order, limit, or select, replaces the receiver’s:

```ts
const recent = User.order({ createdAt: "desc" }).limit(10);
const admins = await User.where({ role: "admin" }).merge(recent).toArray();
```

::: rails Compared with Rails
Rails adds the argument’s order to the receiver’s. d1-record replaces it.
:::

## Preloading associations

`includes` loads associations for every record, with one query per association, all in one round trip with the records’ own query. See [Associations](./associations#preloading-associations).
