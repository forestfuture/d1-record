---
"@forestfuture/d1-record": patch
---

`withSession` now answers a request whose bookmark D1 can’t use, such as a forged cookie. D1 rejects that bookmark on the Session’s first statement. The Session then starts again from `start`, the statement is sent again, and the response gets a fresh bookmark. Before, every request carrying the bookmark failed until the cookie changed. A bookmark given to `connect(env.DB, { session })` still throws. In D1’s error, a long bookmark is cut short.
