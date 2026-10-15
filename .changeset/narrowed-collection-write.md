---
"@forestfuture/d1-record": patch
---

A write through a narrowed `hasMany` (`post.comments().where({ … }).deleteAll()`, or `updateAll`, `insert`, `upsert`) clears the owner's loaded collection, as the same write without the `where` does, so the next read no longer returns rows the write deleted or changed.
