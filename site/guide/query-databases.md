---
description: "How a query finds its D1 database (a Model's binding, the request's database, or an explicit one), why nothing about a request is ever stored on a Model class, and how this compares to Rails."
---

# Where a query's database comes from

In Rails, `Product.find(id)` just works: the model knows its database. d1-record keeps that, `Product.find(id)` works, but a Worker isn't a Rails server, and the difference shapes how a query finds its database.

## One isolate, many requests

A Worker runs in an **isolate** that serves many requests at the same time, and a Model class is shared by all of them. So anything stored on a class is shared by every request in flight. That rules out storing a connection on a class: some of what a connection carries belongs to one request only.

- **A D1 Session** keeps one user's reads at least as new as their own writes. Shared, one user's Session would serve another's queries.
- **An `onQuery` listener** might tag each query with its request's ID. Shared, it would mix requests.

Rails doesn't keep its connection on the class either: each thread checks one out from a pool, and gives it back afterwards. The JavaScript equivalent of "per request, without passing it around" is `AsyncLocalStorage`, which follows a request through every `await`.

## Three ways to find a database

So a query finds its database one of three ways, in this order:

1. **The request's database.** Inside `withDatabase(connect(env.DB, { session, onQuery }), fn)`, everything `fn` awaits uses that database, kept in the request's `AsyncLocalStorage`, never on a class. It's matched to Models by binding, so a request can open several.
2. **The Model's binding.** Outside `withDatabase`, a Model uses the D1 binding its base class names (`static binding = "DB"`), read from `cloudflare:workers`. The binding is the same object for every request, and the database made for it holds nothing per request (no Session, no listener), so sharing it is safe. This is what makes `Product.find(id)` work with no setup.
3. **An explicit database.** `connect(env.DB).model(Product)` always uses that database, whatever `withDatabase` says. It suits code that passes its database around, or uses two at once.

Most apps only ever use the second. The first exists for what belongs to a request: Sessions, per-request logging, and tests, which run outside a Worker and have no binding to find.

## What follows from it

- **Records remember.** A record keeps the database it was loaded through, or first saved through, so `post.save()` and `post.user()` use it later, even after `withDatabase` has returned.
- **A batch has one database.** `batch([...])` runs on the database its entries were built on, and refuses entries from two.
- **Errors say where the database should come from.** A query outside a Worker with no `withDatabase`, a Model with no binding, or a query at a module's top level (where Workers allow no I/O) each throws `NoDatabase`, saying what to do.

For the options themselves, see [Connecting](./connecting).
