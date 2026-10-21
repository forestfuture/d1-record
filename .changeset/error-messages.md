---
"@forestfuture/d1-record": patch
---

Error messages can be changed: `this.errorMessages({...})` in the app's base class or a Model replaces the built-in English, for every attribute or one, and `this.humanAttributeNames({...})` names attributes in `fullMessages()`. A message is looked up when it's read, with `%{count}`, `%{attribute}`, `%{model}` and `%{value}` filled in. `errors.add(attribute, { type })` looks its message up, and `toArray()` gives an error's `values`, such as `count`.
