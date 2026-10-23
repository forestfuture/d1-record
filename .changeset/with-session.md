---
"@forestfuture/d1-record": patch
---

`withSession(request, env.DB, fn)` opens a D1 Session for each request and carries its bookmark to the user's next request, so with read replication a user reads at least as new as their last write. The bookmark travels in a `d1-bookmark` cookie by default. For APIs, `{ header: "x-d1-bookmark" }` carries it in a header instead. `cookie` renames the cookie. `start: "first-primary"` starts a request with no bookmark on the primary. A response whose headers can't change, such as a redirect, is copied to carry it.
