---
"@forestfuture/d1-record": patch
---

Error messages can be changed: `static errorMessages` on the app's base class or a Model replaces the built-in English, for every attribute or one, and `static humanAttributeNames` names attributes in `fullMessages()`. A message is looked up when it's read, with `%{count}`, `%{attribute}`, `%{model}` and `%{value}` filled in. `errors.add(attribute, { type })` looks its message up, and `toArray()` gives an error's `values`, such as `count`.
