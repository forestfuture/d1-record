# Connecting

Every query goes through a **Database**: a wrapper around your D1 binding that you create once per request with `connect(env.DB)`.

<<< @/snippets/guide/connecting.ts#connect{ts}

`db.model(User)` is where every query and every new record starts. Records remember the Database they were built or loaded through, so `user.save()` and `user.posts()` use the same connection later.

::: tip Why not `User.find(id)`?
In Rails, a Model class talks to the database directly. On Workers, one isolate serves many requests at once, so anything stored on a class would be shared between them. d1-record never keeps request state on a Model class: the Database comes from the request, and everything reached through it stays with that request.
:::

If you'd rather name your Models once, `db.models({...})` gives you the same `db.model(...)` for each:

<<< @/snippets/guide/connecting.ts#models{ts}

A record made with `new User()` has no Database. Anything that needs D1 throws `NoDatabase`, so build records with `db.model(User).build(...)` instead.

## Read replicas and sessions

With [D1 read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/) turned on, reads can be served by replicas that may lag behind the primary. A **session** keeps a request consistent: every query goes through one D1 Session, so the request always reads its own writes.

`session` takes D1's own values:

- `"first-unconstrained"`: the first query goes to whichever instance is nearest, the primary or a replica. It's the fastest, but may read slightly old data.
- `"first-primary"`: the first query goes to the primary, so it sees every write made so far.
- A **bookmark**: read at least as new as the moment that bookmark was taken.

`db.bookmark()` is the session's latest bookmark. Hand it to the client, and pass it back on the next request, so a user never sees data older than their own last write:

<<< @/snippets/guide/connecting.ts#session{ts}

After the first query, D1 keeps the session consistent: each later query reads data at least as new as the one before, including the request's own writes. Every query goes through the session: reads, writes, uniqueness checks, association loads, preloads and batches. `db.bookmark()` is `null` before the first query, and throws `NoSession` on a Database opened without one. To use the primary for some queries and replicas for others, call `connect()` twice.

## Watching queries

`onQuery` is called once for every statement sent to D1, batches included, with its SQL, bound values, timing, D1's `meta`, and the error if it failed:

<<< @/snippets/guide/connecting.ts#on-query{ts}

There's no logger built in, so send these wherever you like. In a batch, each statement's `durationMs` is D1's own timing for it. When a batch fails, D1 doesn't say which statement failed, so every statement is reported with the error.
