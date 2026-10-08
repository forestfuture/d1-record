---
"@forestfuture/d1-record": patch
---

`paginate({ page, perPage })` resolves to a page of a Relation's records and its total, `{ records, page, perPage, total, totalPages, hasNext, hasPrevious }`, sending the `COUNT` and the page's `SELECT` to D1 as one batch. `{ count: false }` skips the `COUNT` and reports only `hasNext`. `page` and `perPage` are cast from untrusted input, and `static perPage` (25) and `static maxPerPage` (100) set a page's default and largest size.
