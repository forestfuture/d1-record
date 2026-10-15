---
"@forestfuture/d1-record": patch
---

A `hasMany` read sent before a write through it, and answered after, no longer leaves the old rows loaded: the read still resolves to what it loaded, and the next read queries again.
