---
"@forestfuture/d1-record": patch
---

A name every object inherits (`constructor`, `__proto__`, `toString`, `hasOwnProperty`), from a URL's `?include=` or a JSON key, is `UnknownAttribute` or `UnknownAssociation` from every method that takes a name, like any unknown name. Before, `includes`, `reloadAssociation`, `loaded`, `isLoaded` and the change-tracking methods found JavaScript's own members instead, and threw a `TypeError` or gave a wrong answer. Reading an unknown attribute through a change-tracking method is now `UnknownAttribute` too.
