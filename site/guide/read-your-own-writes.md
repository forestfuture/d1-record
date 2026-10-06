---
description: "With D1 read replication, keep each user's reads at least as new as their own writes: a D1 Session per request, opened in middleware from a bookmark cookie."
---

# Read replicas

With [D1 read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/), reads can come from a nearby replica that may be a moment behind. A D1 **Session** keeps each user’s reads at least as new as their own writes.

## Opening a Session for each request

Open the request’s database with a Session, run the request inside `withDatabase`, and keep the Session’s latest bookmark in a cookie:

<<< @/snippets/guide/connecting.ts#session{ts}

Every query inside it goes through the Session, including uniqueness checks, association loads, preloads, and batches. Records loaded there keep using it. The bookmark carries the Session to the user’s next request.

::: warning TIP
`withDatabase` needs Node.js compatibility, which is on by default for compatibility dates from 2026-08-04. For an earlier date, add `"compatibility_flags": ["nodejs_compat"]`.
:::

## Choosing where a Session starts

`session` takes D1’s own values:

| `session`               | The first query goes to                                                                |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `"first-unconstrained"` | The nearest instance, primary or replica. The fastest, but may read slightly old data. |
| `"first-primary"`       | The primary, so it sees every write made so far.                                       |
| A bookmark              | An instance at least as new as the moment the bookmark was taken.                      |

After the first query, each query reads data at least as new as the one before, including the request’s own writes.

- **`db.bookmark()`** is the Session’s latest bookmark. It’s `null` before the first query, and throws `NoSession` on a database opened without a Session.
- **To mix the primary and replicas**, open two databases, and use `db.model(…)` with each.
