---
"@forestfuture/d1-record": patch
---

A name every object inherits (`constructor`, `__proto__`, `toString`, `hasOwnProperty`) passed to `includes`, `reloadAssociation`, `loaded`, `isLoaded` or a change-tracking method is `UnknownAssociation` or `UnknownAttribute`, like any unknown name, instead of a `TypeError` or a wrong answer.
