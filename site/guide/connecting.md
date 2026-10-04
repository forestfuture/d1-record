---
description: "How a query finds its database: a Model's binding with no setup (User.find(id)), withDatabase for a request's Session or onQuery, or an explicit connect(env.DB). Read replicas, bookmarks, batches and watching queries."
---

# Connecting

A query finds its D1 database in one of three ways. Most apps only ever use the first.

|                               | How                                                      | Use it for                                                                     |
| ----------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **1. The binding**            | `User.find(id)`, nothing to set up                       | Everyday queries                                                               |
| **2. The request's database** | `withDatabase(connect(env.DB, …), fn)`, once per request | Read replicas with a Session, per-request `onQuery` logging, tests and scripts |
| **3. An explicit database**   | `connect(env.DB).model(User).find(id)`                   | Code that passes its database around, or uses two at once                      |

## 1. The binding: no setup

Each Model names the D1 binding it queries, as Rails' `connects_to` does. `d1-record schema` writes it into your app's base class from your Wrangler config's `d1_databases` (`static override binding = "DB"`), so every Model has it. Then a Model queries by itself, during any request:

<<< @/snippets/guide/connecting.ts#binding{ts}

Every Relation method is there on the Model: `find`, `findBy`, `where`, `order`, `first`, `count`, `pluck`, `create`, `insertAll`, `updateAll`, `deleteAll` and the rest, plus the Model's scopes (`User.active()`) and `User.all()` for the Relation itself. Records remember where they came from, so `user.save()` and `user.posts()` use the same database later.

The binding is read with `import { env } from "cloudflare:workers"`, which needs no setup. Two things follow from where that works:

- **During a request only.** Workers don't allow D1 calls at a module's top level, outside a request, so a query there fails.
- **Inside a Worker only.** Tests and scripts running in Node have no `env.DB`; give them their database with `withDatabase` ([below](#tests-and-scripts)).

::: tip Why this is safe on Workers
One isolate serves many requests at once, and a Model class is shared by all of them. So nothing about a request is ever stored on a class. The binding is the same object for every request; a request's own Session or `onQuery` lives only in its `withDatabase`, never on a class.
:::

## 2. The request's database: `withDatabase`

Some things belong to **one request**: a D1 Session that reads its own writes, or `onQuery` logging tagged with the request's ID. For those, open a database for the request and run its code inside `withDatabase`. Every query started from a Model inside it (and everything it awaits) uses that database instead of the bare binding. Usually it's one line, in middleware or at the top of `fetch`.

::: info Node.js compatibility
`withDatabase` uses Workers' `AsyncLocalStorage`. It's on by default for compatibility dates from 2026-08-04; for an earlier date, add `"compatibility_flags": ["nodejs_compat"]` to your Wrangler config. Without it, `withDatabase` throws `NoDatabase` saying so. The rest of d1-record doesn't need it.
:::

What a request's database is for, step by step:

- **[Read your own writes](./read-your-own-writes):** a D1 Session per request, with read replicas.
- **[Log queries](./logging):** one request's queries, tagged with its ID.
- **[Test with Miniflare](./testing):** giving Models a database outside a Worker.
- **[Use several databases](./several-databases):** `withDatabase([...])`, matched to each Model's binding.

## 3. An explicit database: `db.model`

`connect(env.DB)` returns a database you hold yourself, and `db.model(User)` starts every query and new record from it, whatever `withDatabase` says:

<<< @/snippets/guide/connecting.ts#explicit{ts}

If you'd rather name your Models once, `db.models({...})` gives you the same `db.model(...)` for each:

<<< @/snippets/guide/connecting.ts#models{ts}

`connect(env.DB, { session, onQuery })` takes the same options as above.

## Batches

`batch([...])` writes statements and records atomically, on the database they were built on: all of them, or none. Entries from a Model's statics use the current database, the request's or the binding's; `db.batch([...])` does the same for an explicit database. Entries from two databases are refused (`IncompatibleRelation`). See [Batches and bulk writes](./batches).

<<< @/snippets/guide/connecting.ts#batch{ts}

## Which do I need?

| Your situation                                               | What to do                                                           |
| ------------------------------------------------------------ | -------------------------------------------------------------------- |
| A Worker with one D1 database                                | Nothing: `User.find(id)` uses its binding                            |
| D1 read replication, reading your own writes                 | [A Session per request](./read-your-own-writes)                      |
| Logging queries, or `Server-Timing`                          | [`onQuery`](./logging), app-wide or per request                      |
| Vitest tests, seed or migration scripts                      | [`withDatabase(connect(binding), …)`](./testing), or `db.model(...)` |
| Several D1 databases                                         | [One base class per binding](./several-databases)                    |
| A compatibility date before 2026-08-04, using `withDatabase` | Add `nodejs_compat` to your Wrangler config's `compatibility_flags`  |

A record made with `new User()` has no database: anything that needs D1 throws `NoDatabase`. Build records with `User.build(...)` (or `db.model(User).build(...)`) instead.
