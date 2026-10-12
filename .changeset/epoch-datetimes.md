---
"@forestfuture/d1-record": patch
---

A `datetime` can be stored as a Unix time in an `INTEGER` column: declare it with `storage: "unixSeconds"` or `"unixMilliseconds"`, as in `ApplicationRecord("posts", { publishedAt: { type: "datetime", storage: "unixSeconds" } })`, to read and write Drizzle's `timestamp` and `timestamp_ms` columns as `Date`s. A stored date with no time zone, as SQLite's `DEFAULT CURRENT_TIMESTAMP` writes it, now reads as UTC instead of the process's time zone. `d1-record schema`'s notes for a numeric timestamp name the override, and Prisma's `datetime` columns no longer get a note, since Prisma writes ISO text to D1.
