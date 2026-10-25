---
"@forestfuture/d1-record": patch
---

`withSession` answers a request whose bookmark D1 can’t use, such as a forged or old cookie: D1 rejects it on the Session’s first statement, so the Session starts again from `start`, that statement is sent again, and the response gets a fresh bookmark. Before, every request carrying the bookmark failed until it changed. A bookmark given to `connect(env.DB, { session })` still throws, and a long one is cut short in the error’s message.
