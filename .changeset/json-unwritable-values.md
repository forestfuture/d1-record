---
"@forestfuture/d1-record": minor
---

A `json` attribute refuses a value JSON can't write (a `BigInt`, an object that refers to itself, a function, or a symbol) when it's assigned, with a `TypeError` that names the Model and attribute. It used to fail at save with JSON's own error, and a function in a bulk write was stored as NULL without an error. A condition with such a value matches nothing.

A value changed in place into one JSON can't write throws the same `TypeError` at save or `isChanged()`, and a `json` cell that isn't JSON throws it when the record loads or `pluck` reads it, instead of the parser's `SyntaxError` (which showed a filtered attribute's cell through `pluck`). A cell in a Unix time column that isn't a time now fails `pluck` the same way, where it gave an invalid `Date`.
