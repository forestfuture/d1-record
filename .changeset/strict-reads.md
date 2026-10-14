---
"@forestfuture/d1-record": minor
---

A stored cell that isn't the attribute's type now fails when it's read, naming the Model and attribute, where it was read loosely: ISO text that isn't a date (an Invalid `Date`), a number in an ISO `datetime` column (a moment in January 1970), a boolean other than 0 and 1 (`false`), and text or a fraction in an `integer`, `real`, or `string` column. A record load, `pluck`, and `typeForAttribute(...).deserialize` read the same way.

A `datetime` with a `storage` no longer reads `""`, `true`, or numeric text through `Number()`, and ISO text with more than nine fractional digits is refused. To fix a column, declare its `storage`, correct its type, or ignore it: the guide's "Fixing cells of the wrong type" shows how. `d1-record schema` now notes a column with no declared type, which it reads as a string.
