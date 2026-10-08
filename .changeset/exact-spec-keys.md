---
"@forestfuture/d1-record": patch
---

A misspelled key in an attribute spec (`{ type: "string", nul: false }`), in `Model({...})` or `ApplicationRecord({...})`, is now a compile error instead of being silently ignored.
