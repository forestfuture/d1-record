---
"@forestfuture/d1-record": minor
---

Bulk writes run when called, as in Rails: `await posts.deleteAll()` and `updateAll(…)` resolve to the number of rows (on `none()`, `0` without a query), and `insert`, `insertAll`, `upsert` and `upsertAll` to D1's `meta`. For `db.batch([...])`, use their `to…` forms (`toInsert`, `toUpdateAll`, `toDeleteAll`, …), as records use `toSave()`/`toDestroy()`. **Breaking:** `.run()` is gone. Drop it where a write ran on its own, and use the `to…` form where a write went into a batch.
