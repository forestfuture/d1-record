---
"@forestfuture/d1-record": patch
---

A statement built through a `hasMany` (`post.comments().toUpdateAll(…)`, `toDeleteAll`, `toInsert`) clears the owner's loaded collection again when `db.batch` writes it, so a collection read between building the statement and running the batch no longer keeps the old rows.
