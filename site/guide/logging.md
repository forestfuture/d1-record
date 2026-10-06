---
description: "See the SQL your Worker sends to D1: every query app-wide, one request's queries with its ID, only in development, in Workers Logs, and as Server-Timing."
---

# Logging

`onQuery` is called once for every statement sent to D1, writes and batches included, with:

| Field           |                                                                  |
| --------------- | ---------------------------------------------------------------- |
| `model`         | The Model’s class name, such as `"Product"`                      |
| `sql`, `params` | The statement and its bound values                               |
| `durationMs`    | How long it took; in a batch, D1’s own timing for each statement |
| `meta`          | D1’s result metadata (rows read and written, …)                  |
| `error`         | D1’s error, when it failed                                       |

There’s no logger built in, so send these wherever you like. A listener never changes a query’s outcome: one that throws is logged with `console.error`, and the query’s result stands.

There are two places to set it:

|                           | Where                                                 | Knows the request? |
| ------------------------- | ----------------------------------------------------- | ------------------ |
| **Every query, app-wide** | `static override onQuery` on your app’s base class    | No                 |
| **One request’s queries** | `connect(env.DB, { onQuery })`, run in `withDatabase` | Yes                |

Both can be set: for each query, the request’s listener runs first, then the base class’s.

## Every query, app-wide

On your app’s base class, in `application-record.ts`, `onQuery` sees every statement of every Model:

<<< @/snippets/guide/connecting.ts#app-wide{ts}

A function that holds nothing about a request is safe on a class, but it can’t tell requests apart. A Model can set its own `static override onQuery`, which replaces the base class’s for that Model.

## One request’s queries

To group a request’s queries, open its database with a listener that knows the request, and run the request inside `withDatabase`. Wrap whatever your app exports as its Worker:

<<< @/snippets/guide/connecting.ts#per-request{ts}

Logged as JSON, each line can be filtered by `requestId` in [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/). Turn them on with `"observability": { "enabled": true }` in your Wrangler config.

`withDatabase` needs Node.js compatibility, which is on by default for compatibility dates from 2026-08-04; for an earlier date, add `"compatibility_flags": ["nodejs_compat"]`.

## Only in development

Key the listener on a variable that only `.dev.vars` sets (`LOG_SQL=1`). For one request’s listener:

<<< @/snippets/guide/connecting.ts#development{ts}

The app-wide listener has no `env` of its own, so it reads the variable from `cloudflare:workers` when a query runs:

<<< @/snippets/guide/connecting.ts#app-wide-development{ts}

## In the browser: `Server-Timing`

To see a request’s database time in the browser’s developer tools, add it up and send it as a `Server-Timing` header:

<<< @/snippets/guide/connecting.ts#server-timing{ts}

## Keep secrets out of the logs

Listeners see the values of passwords, tokens, keys, and emails as `"[FILTERED]"`, with no setup: D1 still gets the real values. [Models](./models#filtering-attributes) lists which attributes are filtered by default, and everywhere their values are hidden.

### Add your own attributes

Name them on your app’s base class. Setting `filterAttributes` replaces the defaults, so spread them in:

<<< @/snippets/guide/filtering.ts#add{ts}

A string matches any attribute whose snake_case name contains it, so `"iban"` also covers `ibanNumber`. Use a RegExp to match one name exactly.

### See a filtered attribute while debugging

Leave it out of the list, in development only: `static override filterAttributes = Model.Base.filterAttributes.filter((entry) => entry !== "email")`.

### Keep secrets out of `sql` fragments

A value inside an `sql` fragment has no attribute, so it’s logged as given. Compare secrets through a condition (`where({ token })`), which is filtered, or leave `params` out of what you log.

::: tip Compared with Rails
Rails filters by its app-wide `filter_parameters`, against parameter and column names. d1-record keeps the list on the Model (`static filterAttributes`, inherited from your base class), and matches each entry against the attribute’s snake_case name, so `"_key"` filters `apiKey`. A RegExp may match either form. It also hides filtered values in cast errors and in `RecordNotFound`, which Rails’ filter doesn’t cover.
:::
