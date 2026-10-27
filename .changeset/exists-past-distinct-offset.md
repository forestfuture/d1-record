---
"@forestfuture/d1-record": patch
---

`exists()`, `isEmpty()` and `hasAny()` now give the right answer after `distinct()` with an offset. `Post.select("title").distinct().offset(1).exists()` was `false` even when `toArray()` returned records, because every match counted as one row and the offset skipped it.
