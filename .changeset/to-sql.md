---
"@forestfuture/d1-record": patch
---

`toSql()` shows the SQL a query would send, without sending it: `User.where({ role: "admin" }).toSql()` returns `{ sql, params }` for the SELECT that `toArray()` sends, with the values bound apart from the SQL. A Statement from `toInsert`, `toUpdateAll`, `toDeleteAll`, and the other `to…` methods has it too. A `none()` Relation shows its `1 = 0` form. The values are real, filtered attributes included, which `onQuery` still hides. A record's `toSave()` and `toDestroy()` have no `toSql()`, since their SQL depends on callbacks that run inside the batch.
