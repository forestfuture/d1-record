---
"@forestfuture/d1-record": patch
---

After an update, a record holds what D1 stored for its attributes, as it does after an insert or a reload: a `json` value's `NaN` is `null`, where it stayed `NaN` until the record was reloaded. `undefined` given to `column(attribute).value()` or `permit` now throws the same `TypeError` as assigning it: `got undefined for "attribute"; use null to store NULL`.
