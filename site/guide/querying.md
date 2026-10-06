---
description: "Reference for querying: a Model's statics, Relations, where and comparisons, sql fragments, ordering and paging, find/findBy/first/count, partial records, none(), merge, scopes and preloading."
---

# Querying

A query is a **Relation**: a description of which records you want. Every method that narrows, orders or pages a query returns a new Relation, and nothing is sent to D1 until you ask for results.

<<< @/snippets/guide/querying.ts#relation{ts}

Relations aren’t promises: they have no `then`, so an `async` function that returns one never runs it by accident. Ask for results with a terminal method such as `toArray()`, `first()` or `count()`.

## Starting a query

Every Relation method is also a static of every Model, as in Rails: `User.where(…)`, `User.find(id)`, `User.order(…)`, `User.count()`, `User.create(…)`, and the rest, typed for the class you call it on (on a subclass, its records are the subclass). `User.all()` is the Relation itself, and a Model’s scopes are statics too (`User.active()`).

A query started from a Model runs on the current database: the request’s, if it was opened with `withDatabase`, or else the Model’s binding. `db.model(User)` starts the same Relation on an explicit database instead. See [Connections](./connecting).

## Conditions

`where` takes an object of attributes, all of which must match:

<<< @/snippets/guide/querying.ts#where{ts}

- `null` matches NULL (`IS NULL`), and an array matches any of its values. The whole list is bound as one value, so it can be any length without reaching D1’s limit of 100 bound parameters.
- `whereNot` negates the whole condition. As in SQL, `whereNot({ role: "admin" })` also leaves out users whose role is NULL.
- `or` combines two Relations of the same Model whose only difference is their conditions.
- `where({})` adds nothing. An `undefined` value throws `TypeError`, since binding it would silently match nothing: leave the key out, or use `null`.
- Values are [cast to the attribute’s type](./models#assigned-values-are-cast), so `where({ quantity: "42" })` finds 42, and `where({ code: 7 })` finds the code `"7"`. A value that can’t be cast (`"abc"` for an integer) matches nothing, never NULL: `findBy` resolves to `null`, and `find` throws `RecordNotFound`. In a list, values that can’t be cast are left out. So `whereNot` with one excludes nothing: check an id from a request before excluding by it.

### Comparisons

Ranges and comparisons are small helpers you pass as a value:

<<< @/snippets/guide/querying.ts#comparisons{ts}

`gt`, `gte`, `lt`, `lte` and `between` work on number, string and datetime attributes, and their values are converted like the attribute’s own, so dates compare by time. `between` includes both ends, like Rails’ `start..end`, and `{ excludeEnd: true }` is `start...end`.

### SQL fragments

Anything else is an `sql` tagged template. Values are always bound. Fragments are SQL, so they name columns, and `column()` looks one up from its attribute:

<<< @/snippets/guide/querying.ts#sql{ts}

## Ordering and paging

<<< @/snippets/guide/querying.ts#order{ts}

`order` sorts by each key in turn, and calling it again adds more keys. NULLs sort first in ascending order, as SQLite sorts them, unless you place them with `nulls`. `reorder` replaces the order so far, and `reorder()` removes it.

## Getting results

<<< @/snippets/guide/querying.ts#terminal{ts}

- `find` takes an id and throws `RecordNotFound` if it’s missing. Given several ids, it resolves to an array in the ids’ order, from one query, and throws if any are missing.
- `findBy` resolves to `null` when nothing matches, and `findByOrThrow` throws `RecordNotFound`.
- `first` and `last` sort by the primary key unless the Relation has an order, and `last` reverses that order. It can’t reverse an `sql` fragment, so it throws `IrreversibleOrder` there.
- `count()` always agrees with the number of records `toArray()` would return, even with `limit`, `offset` or `distinct`.
- `size()`, `isEmpty()` and `hasAny()` are Rails’ `size`, `empty?` and `any?`. On a loaded association they answer without a query.

## Partial records

`select` loads only some attributes. The primary key is always loaded too, so partial records can still be saved:

<<< @/snippets/guide/querying.ts#select{ts}

Reading an attribute that wasn’t loaded throws `MissingAttribute`, including from a validator or callback. Saving a partial record writes only what changed, and never fills in what wasn’t loaded. `reload()` loads the whole row.

After `distinct()` the primary key isn’t added, since it would make every row distinct, so those records can’t be saved.

## Nothing at all

`none()` is a Relation that matches nothing without asking D1: `toArray()` is `[]`, `count()` is `0`, `first()` is `null`, and chaining more onto it keeps it empty.

<<< @/snippets/guide/querying.ts#none{ts}

## Scopes

Scopes are named, reusable parts of a query, declared one static each, as Rails’ `scope :active, -> { … }`. A scope receives the current Relation, plus any arguments, and returns a narrower one:

<<< @/snippets/guide/models.ts#declare{ts}

<<< @/snippets/guide/models.ts#scopes{ts}

- **Called anywhere:** as a static (`User.active()`), or on any Relation of the Model (`User.where(…).active()`), chaining with everything else. A wrong argument type or an unknown scope is a compile error.
- **Evaluated when called:** a scope’s arguments, and anything it computes such as `new Date()`, are evaluated when you call it, not when the class is defined. Calling a scope never queries on its own.
- **Inherited** down any chain of classes, as statics are, including scopes on your app’s base class ([Shared behavior](./shared-behavior)). A subclass can replace one with `static override active = this.scope(…)`.
- **Names:** a scope can’t reuse a Relation method’s name (`where`, `count`) or a Model static’s (`validates`, `scope`, `all`).
- **Inside a scope**, `q` has every Relation method but not the Model’s other scopes; share logic between scopes with a plain function. A scope whose body names its own class needs its type written out: `static roots: ScopeStatic<[]> = this.scope(…)`.

## Combining Relations

`merge(other)` combines two Relations of the same Model: their conditions are joined with AND, and anything the argument sets (order, limit, select, …) replaces the receiver’s. Unlike Rails, orders are replaced rather than added together.

## Preloading associations

`includes` loads associations for every record in one query each, never one per record. See [Associations](./associations#preloading).
