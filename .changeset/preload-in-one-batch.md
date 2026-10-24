---
"@forestfuture/d1-record": patch
---

`includes()` sends the whole tree with the records' own query, in one round trip, however deep: each association's query finds its owners' keys with a subquery, not with keys bound after the level above comes back. `includes({ posts: "comments" })` was three round trips and is now one, and every level reads the same data. With a `limit` or `offset`, a query with `includes` now ends its order with the primary key, so its preloads find the records it loads. So `take()` and a `limit()` with no order now come back in primary-key order. Each preload runs the query's conditions again, and its order with a `limit` or `offset`, so index what a query with `includes` filters and sorts by. A nested query that would bind more than D1's 100 values takes one more round trip. `paginate()` sends its count, its page and the page's preloads in one batch.
