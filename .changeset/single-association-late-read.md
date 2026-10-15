---
"@forestfuture/d1-record": patch
---

A `belongsTo` or `hasOne` read sent before `post.author.set(…)`, `user.profile.build(…)` or `create`, or `reload()`, and answered after it, no longer replaces what that write left loaded: the read still resolves to the record it loaded, and the record the write made stays loaded.
