---
"@forestfuture/d1-record": patch
---

A write through a Relation that joins a `hasMany`, on the right of `or()` or `merge()` (`db.model(Post).where({ … }).or(user.posts()).deleteAll()`) or through a scope that starts a new query, clears the owner's loaded collection, as the same write through the `hasMany` itself does, so the next read no longer returns rows the write deleted or changed.
