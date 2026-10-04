---
"@forestfuture/d1-record": patch
---

Queries start from the Model, as in Rails: `User.find(id)`, `User.where(…)`, `User.create(…)`, `User.active()`, and every other Relation method as a typed static. With no setup they use the Model's binding (`static binding = "DB"`, written on your `ApplicationRecord`'s base class by `d1-record schema`). For a D1 Session, per-request `onQuery`, or tests outside a Worker, `withDatabase(connect(env.DB, { … }), fn)` gives a request its own database. `batch([...])` writes atomically on the current database. `db.model(X)` still works as before.

Scopes are now declared one static each, as Rails' `scope :active, -> { … }`: `static active = this.scope((q) => q.where({ isActive: true }))`, replacing `static scopes = this.defineScopes({...})`. They inherit like any static.
