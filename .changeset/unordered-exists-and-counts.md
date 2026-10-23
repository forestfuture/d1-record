---
"@forestfuture/d1-record": patch
---

`exists()`, `isEmpty()` and `hasAny()` no longer send a Relation's order, and neither do `count()`, `count(attribute)` and `paginate()`'s count when the Relation has no `limit` or `offset`. The order can't change their answers, but SQLite still sorted every matching row first, and D1 bills each row read. On an ordered Relation, `exists()` now reads one row instead of every match, and a count reads each match once. The answers are unchanged.
