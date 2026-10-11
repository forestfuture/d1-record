---
"@forestfuture/d1-record": patch
---

`d1-record schema` keeps a `__proto__` key in a JSON column's default. The generated `schema.ts` wrote it as `__proto__: …`, which in an object literal sets the object's prototype and drops the key, so a default such as `{"__proto__":{"a":1},"b":2}` came out as `{"b":2}`. It's now written as a computed key, and the default is the value the migration declared.
