---
"@forestfuture/d1-record": patch
---

A Model's `tableName` is inferred from its class name, as Rails does (`User` → `users`, `BlogPost` → `blog_posts`, `Person` → `people`), so most Models no longer declare it. `static tableName` still overrides it.
