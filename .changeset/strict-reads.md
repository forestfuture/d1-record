---
"@forestfuture/d1-record": minor
---

A stored cell that isn't the attribute's type now fails when it's read, naming the Model and attribute, where it was read loosely: ISO text that isn't a date (an Invalid Date), a number in an ISO `datetime` column (a moment in January 1970), a boolean other than 0 and 1 (`false`), and text or a fraction in an `integer`, `real`, or `string` column. A load, `pluck`, and `typeForAttribute(...).deserialize` read the same way. To fix a column, declare its `storage`, correct its type, or ignore it; the guide's "Fixing cells of the wrong type" shows how.
