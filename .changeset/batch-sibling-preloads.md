---
"@forestfuture/d1-record": patch
---

`includes` sends the associations at each level of the tree to D1 together, in one round trip, so `includes("articles", "publisher")` takes two round trips instead of three, and nested includes take one round trip per level instead of one per association. The records loaded are unchanged. A scope that can't be preloaded (`limit`, `offset`, or `distinct`) now throws `IncompatibleRelation`, at any level, before any preload query is sent.
