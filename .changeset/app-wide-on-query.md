---
"@forestfuture/d1-record": patch
---

An app-wide query logger: `static override onQuery: QueryListener = (event) => …` on your app's base class sees every statement of every Model, whichever database runs it, after the database's own `onQuery`. Every query event now says which Model it's for (`event.model`). The guide's Connecting page has a new Logging queries section: app-wide, per request with its ID, development only, Workers Logs, and `Server-Timing`.
