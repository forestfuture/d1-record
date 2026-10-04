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

### Read replicas and sessions

With [D1 read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/) turned on, reads can be served by replicas that may lag behind the primary. A user who saves something and is redirected could then see the old value. A **Session** keeps a request consistent: every query goes through one D1 Session, so the request always reads its own writes. `session` takes D1's own values:

- `"first-unconstrained"`: the first query goes to whichever instance is nearest, the primary or a replica. It's the fastest, but may read slightly old data.
- `"first-primary"`: the first query goes to the primary, so it sees every write made so far.
- A **bookmark**: read at least as new as the moment that bookmark was taken.

`db.bookmark()` is the Session's latest bookmark. Keep it in a cookie, and open the next request's Session from it, so a user never sees data older than their own last write. As middleware, around every request:

<<< @/snippets/guide/connecting.ts#session{ts}

After the first query, D1 keeps the Session consistent: each later query reads data at least as new as the one before, including the request's own writes. Every query goes through it: reads, writes, uniqueness checks, association loads, preloads and batches. `db.bookmark()` is `null` before the first query, and throws `NoSession` on a database opened without one.

### Logging one request's queries

A database opened for the request can carry its own `onQuery`, which can tag each query with the request. See [Logging queries](#logging-queries).

### Tests and scripts

Outside a Worker (a Vitest test against Miniflare's D1, a seed script) there's no binding to find, so name the database for the code:

<<< @/snippets/guide/connecting.ts#test{ts}

### Several databases

`withDatabase` takes a list. Each Model uses the one on its own binding (its base class's `static binding`), and Models on other bindings keep using theirs:

<<< @/snippets/guide/connecting.ts#several{ts}

## 3. An explicit database: `db.model`

`connect(env.DB)` returns a database you hold yourself, and `db.model(User)` starts every query and new record from it, whatever `withDatabase` says:

<<< @/snippets/guide/connecting.ts#explicit{ts}

If you'd rather name your Models once, `db.models({...})` gives you the same `db.model(...)` for each:

<<< @/snippets/guide/connecting.ts#models{ts}

`connect(env.DB, { session, onQuery })` takes the same options as above.

## Logging queries

`onQuery` is called once for every statement sent to D1, batches included, with the Model it's for (`model`, its class name), its SQL, bound values, timing, D1's `meta`, and the error if it failed. There's no logger built in, so send these wherever you like. In a batch, each statement's `durationMs` is D1's own timing for it; when a batch fails, D1 doesn't say which statement failed, so every statement is reported with the error.

There are two places to set it:

|                           | Where                                                 | Knows the request?         |
| ------------------------- | ----------------------------------------------------- | -------------------------- |
| **Every query, app-wide** | `static override onQuery` on your app's base class    | No                         |
| **One request's queries** | `connect(env.DB, { onQuery })`, run in `withDatabase` | Yes: tag lines with its ID |

Both can be set: for each query, the database's runs first, then the Model's.

### Every query, app-wide

On your app's base class in `application-record.ts`, `onQuery` sees every statement of every Model, whichever database runs it. A function that holds nothing about a request is safe on a class, but it can't tell requests apart:

<<< @/snippets/guide/connecting.ts#app-wide{ts}

A Model can set its own `static override onQuery`, which replaces the base class's for that Model, as any static does.

### One request's queries

To group a request's queries, open its database with a listener that knows the request, around whatever your app exports as its Worker. Logged as JSON, each line can be filtered by `requestId` in [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) (with `"observability": { "enabled": true }` in your Wrangler config):

<<< @/snippets/guide/connecting.ts#per-request{ts}

### Only in development

Leave `onQuery` out in production by keying it on a variable that only `.dev.vars` sets:

<<< @/snippets/guide/connecting.ts#development{ts}

### `Server-Timing`

To see a request's database time in the browser's developer tools, add it up and send it as a `Server-Timing` header:

<<< @/snippets/guide/connecting.ts#server-timing{ts}

## Batches

`batch([...])` writes statements and records atomically, on the database they were built on: all of them, or none. Entries from a Model's statics use the current database, the request's or the binding's; `db.batch([...])` does the same for an explicit database. Entries from two databases are refused (`IncompatibleRelation`). See [Batches and bulk writes](./batches).

<<< @/snippets/guide/connecting.ts#batch{ts}

## Which do I need?

| Your situation                                               | What to do                                                                                                 |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| A Worker with one D1 database                                | Nothing: `User.find(id)` uses its binding                                                                  |
| D1 read replication, reading your own writes                 | A Session, opened per request with `withDatabase`                                                          |
| Per-request logging or `Server-Timing`                       | `onQuery`, on a database opened per request with `withDatabase`                                            |
| Vitest tests, seed or migration scripts                      | `withDatabase(connect(binding), …)` around each, or `db.model(...)`                                        |
| Several D1 databases                                         | One base class per binding (`d1-record schema` writes them); `withDatabase([...])` for per-request options |
| A compatibility date before 2026-08-04, using `withDatabase` | Add `nodejs_compat` to your Wrangler config's `compatibility_flags`                                        |

A record made with `new User()` has no database: anything that needs D1 throws `NoDatabase`. Build records with `User.build(...)` (or `db.model(User).build(...)`) instead.
