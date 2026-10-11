---
"@forestfuture/d1-record": patch
---

Assigning a value with no JSON form and no string form (a BigInt inside an array that also holds an object with no prototype) to an attribute is now refused with the usual `TypeError` naming the model and attribute, such as `isn't a string for "label"`. The error's own text for the value threw `Cannot convert object to primitive value` first, which hid which attribute was refused. Values from JSON, a form or a query string were never affected.
