---
"@forestfuture/d1-record": patch
---

A `datetime` can be stored as a Unix time in an `INTEGER` column: declare it with `storage: "unixSeconds"` or `"unixMilliseconds"`, as in `ApplicationRecord("posts", { publishedAt: { type: "datetime", storage: "unixSeconds" } })`, to read and write Drizzle's `timestamp` and `timestamp_ms` columns as `Date`s. `d1-record schema`'s notes for a numeric timestamp, and for a `DATETIME` column that defaults to a number, name the override. Prisma's `datetime` columns no longer get a note, since Prisma writes ISO text to D1.
