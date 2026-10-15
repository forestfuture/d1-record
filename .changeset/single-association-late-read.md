---
"@forestfuture/d1-record": patch
---

A `belongsTo` or `hasOne` read sent before `set`, `build`, `create` or `reload()` (`post.author.set(…)`, `user.profile.build(…)`), and answered after it, no longer replaces what's loaded: the read still resolves to the record it loaded, what `set`, `build` or `create` made stays loaded, and after `reload()` nothing is.
