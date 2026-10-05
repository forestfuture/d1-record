---
"@forestfuture/d1-record": patch
---

A record built from a Relation starts with what its conditions matched: `where({ label: 7 }).build()`, `create()` and `insert()` now give `label: "7"` instead of throwing `TypeError`. A key copied from another record through an association (a `hasMany` or `hasOne` build, `belongsTo` `set()`, or autosave) is cast the same way, so an integer key written into a text foreign key becomes its digits.
