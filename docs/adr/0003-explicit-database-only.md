# Only the explicit Database is supported

**Superseded by ADR-0012**: a query may also use its Model's binding, or the request's database from `withDatabase`.

Records reach D1 only through a **Database** created at the request edge (`const db = connect(env.DB)`, then `db.model(User)`). The original brief also allowed `User.using(env.DB)`, but we don't offer it, even as sugar. Having one way to connect guarantees that no binding or session is ever stored on a Model class, where it could leak between concurrent requests in one isolate. It also gives `batch()` and session routing one owner.

## Amended (#77, 2026-10-03)

A query may now also find its database without a `db` in hand, as Rails' `Product.find(id)` does, and still nothing per-request is stored on a Model class:

- **The Model's binding:** `static binding = "DB"` names a D1 binding, read from `cloudflare:workers` when a query runs. The binding is the same object for every request, and its Database holds no Session or listener, so sharing it across concurrent requests leaks nothing.
- **The request's database:** `withDatabase(db, fn)` keeps a request's Database (with its Session and `onQuery`) in `AsyncLocalStorage`, which belongs to the request, never to a class.
- **An explicit `db`,** as before, for `db.model(X)` and `db.batch([...])`.

`User.using(env.DB)` stays unoffered: it would bind a database to a class.
