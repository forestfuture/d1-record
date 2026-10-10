---
"@forestfuture/d1-record": patch
---

A very long attribute name no longer takes time that grows with the square of its length. `record.errors.fullMessages()` turned an attribute name into words with a rule that took about 6 seconds for a 100,000-character name, so an app that adds an error under a submitted key could be slowed by a long one. It now takes about a millisecond, and every name comes out as before.
