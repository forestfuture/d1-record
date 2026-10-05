---
"@forestfuture/d1-record": patch
---

Whether two queries or records share a database is decided by the database each resolves to when it runs. Inside `withDatabase`, a loaded record's association now merges or ors with a Model's static Relation (`user.posts().merge(Post.published())`), instead of throwing `IncompatibleRelation`. Records autosaved with an owner built from a Model's statics now keep the database they were saved on, as the owner does. A save or destroy whose records are on two databases (a `belongsTo` target built on another `connect()`) is refused before anything is written, as a batch already was. The error names where each database came from.
