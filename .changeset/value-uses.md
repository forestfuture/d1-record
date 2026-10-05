---
"@forestfuture/d1-record": patch
---

A record built from a Relation starts with what its conditions matched: `where({ label: 7 }).build()`, `create()` and `insert()` now give `label: "7"` instead of throwing `TypeError`. A key copied from another record through an association (a `hasMany` or `hasOne` build, an association's `insert`, `belongsTo` `set()`, or autosave) is cast the same way, so an integer key written into a text foreign key becomes its digits, and an error for one that can't be cast names the association. `includes()` across such keys now finds its records instead of preloading none.
