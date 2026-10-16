---
"@forestfuture/d1-record": patch
---

A `hasMany` joined into another Relation now has its loaded collection cleared by writes through that Relation, as writes through the `hasMany` itself already did. This covers a `hasMany` on the right of `or()` or `merge()` (`db.model(Post).where({ … }).or(user.posts()).deleteAll()`) and one passed through a scope that starts a new query, and a `create` through such a Relation too. The next read no longer returns rows the write deleted or changed.
