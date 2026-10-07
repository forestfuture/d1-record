---
"@forestfuture/d1-record": patch
---

`none()` needs no database: `toArray`, `first`, `last`, `take`, `findBy`, and `find` on it answer without one, as `count` and `exists` already did. Before, with no `withDatabase` and no binding, they threw `NoDatabase` even though they never query D1.
