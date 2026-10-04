---
"@forestfuture/d1-record": patch
---

`d1-record g migration Remove…From<Table>` removes a `references` column like any other, dropping its index and then the column: D1 allows it, so it's no longer refused.
