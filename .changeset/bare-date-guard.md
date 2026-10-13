---
"@forestfuture/d1-record": patch
---

An `sql` fragment that compares a bare `Date`, or an ISO datetime string, directly with the column of an attribute stored as a Unix time (`storage: "unixSeconds"` or `"unixMilliseconds"`) now throws `TypeError` where the fragment is used, with the fix in the message. It used to match nothing, or every row, quietly. Use `column("publishedAt").value(date)`.
