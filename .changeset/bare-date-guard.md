---
"@forestfuture/d1-record": minor
---

An `sql` fragment that compares a bare `Date`, or a date text string, directly with the column of an attribute stored as a Unix time (`storage: "unixSeconds"` or `"unixMilliseconds"`) now throws `TypeError` where the fragment is used, with the fix in the message. It used to match nothing, or every row, without an error.

Use `column("publishedAt").value(date)`. An expression around the column, an `IN` list and `IS` are not read.
