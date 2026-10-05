---
"@forestfuture/d1-record": minor
---

Attribute values are cast to their type when they're assigned or given to a bulk write, and in conditions. Only unambiguous values are accepted: `"false"`, `"0"` and `"off"` are `false` for a boolean, `"42"` is `42` for an integer, and an ISO-8601 string is a `Date`. Anything else throws `TypeError`: `"no"` for a boolean, `"12abc"` or `1.7` for an integer, a number for a string, a time without an offset. Before this, `"false"` was saved as `true`, and `"12abc"` was stored in an integer column.

A condition value that can't be cast matches nothing, so `find("abc")` on an integer key throws `RecordNotFound`. In a condition, a number matches a string attribute as its digits (`7` finds `"7"`), as `find` does for a text key.

An override that changes an attribute's `type` without giving a `default` now drops the generated default, so the column's own default applies.
