---
"@forestfuture/d1-record": minor
---

A `json` attribute refuses a value JSON can't write (a `BigInt`, an object that refers to itself, a function, or a symbol) when it's assigned, with a `TypeError` that names the Model and attribute. It used to fail at save with JSON's own error, and a function in a bulk write was stored as NULL without an error. A condition with such a value matches nothing.

A `json` cell that isn't JSON now throws the same `TypeError` when the record loads, instead of the parser's `SyntaxError`.
