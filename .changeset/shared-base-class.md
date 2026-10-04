---
"@forestfuture/d1-record": patch
---

Shared behaviour on `ApplicationRecord`, as in Rails: `modelFor(tables, Base)` builds every Model on `Base`, your class extending the new `Model.Base`, so the methods, static methods, callbacks and scopes you write there are inherited by every Model. The generated `application-record.ts` declares an empty `Base` with commented-out examples. `Base` is abstract: `db.model(Base)` throws `InvalidModel`.
