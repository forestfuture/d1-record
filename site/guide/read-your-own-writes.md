---
description: "With D1 read replication, keep each user's reads at least as new as their own writes: a D1 Session per request, opened in middleware from a bookmark cookie."
---

# Read replicas

With [D1 read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/) turned on, reads can be served by a nearby replica that may be a moment behind the primary. Then a user who saves something and is redirected could see the old value. A **Session** keeps a request consistent: every query goes through one D1 Session, so the request reads its own writes, and its **bookmark** carries that to the user’s next request.

Without read replication, every query goes to the primary, and none of this is needed.

## Open a Session for each request

Open the request’s database with a Session, run the request inside `withDatabase`, and keep the Session’s latest bookmark in a cookie. As middleware, around every request:

<<< @/snippets/guide/connecting.ts#session{ts}

Every query started from a Model inside it, and everything it awaits, goes through the Session: reads, writes, uniqueness checks, association loads, preloads, and batches. Records loaded there keep using it.

`withDatabase` needs Node.js compatibility, which is on by default for compatibility dates from 2026-08-04; for an earlier date, add `"compatibility_flags": ["nodejs_compat"]`.

## Where a Session starts

`session` takes D1’s own values:

| `session`               | The first query goes to                                                                |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `"first-unconstrained"` | The nearest instance, primary or replica. The fastest, but may read slightly old data. |
| `"first-primary"`       | The primary, so it sees every write made so far.                                       |
| A bookmark              | An instance at least as new as the moment the bookmark was taken.                      |

After the first query, D1 keeps the Session consistent: each query reads data at least as new as the one before, including the request’s own writes.

`db.bookmark()` is the Session’s latest bookmark: `null` before its first query, and a `NoSession` error on a database opened without a Session. To use the primary for some queries and replicas for others, open two databases and use `db.model(…)` with each.
