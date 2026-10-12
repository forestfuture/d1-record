---
"@forestfuture/d1-record": patch
---

`column("publishedAt").value(date)` is a value of that attribute for an `sql` fragment, written as the attribute stores it. A plain `Date` in a fragment is ISO text, which doesn't compare with an attribute stored as an integer Unix time (`storage: "unixSeconds"`). The value is cast like an assigned one, stays a bound parameter, and is hidden from `onQuery` for a filtered attribute.
