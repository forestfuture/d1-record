---
"@forestfuture/d1-record": patch
---

A `hasMany` read sent before a write or `create` through it, and answered after, no longer leaves the old rows loaded: the read still resolves to what it loaded, and the next read queries again. A record created through a loaded collection is loaded once, as the record `create` returned.
