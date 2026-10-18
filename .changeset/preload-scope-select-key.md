---
"@forestfuture/d1-record": patch
---

`includes` preloads an association whose scope uses `select()` without its foreign key (`hasMany(Post, { foreignKey: "userId", scope: (q) => q.select("title") })`). The key is now loaded along with the selected attributes, so the records reach their owners instead of throwing `MissingAttribute`. They stay partial.
