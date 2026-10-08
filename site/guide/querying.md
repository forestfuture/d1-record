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
- `includes()` preloads the page’s associations after it, with one more query per association, as for `toArray()`.
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

::: warning Beyond Rails
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

::: warning Compared with Rails
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

::: warning Compared with Rails
Rails adds the argument’s order to the receiver’s. d1-record replaces it.
:::

## Preloading associations

`includes` loads associations for every record, with one query per association. See [Associations](./associations#preloading-associations).
