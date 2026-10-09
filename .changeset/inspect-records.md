---
"@forestfuture/d1-record": patch
---

Records and Relations print readably in a console, a log, or a test failure. A record prints `User { id: 1, name: 'Johnny' (was 'Alice'), email: [FILTERED] }`: its attributes, filtered ones as `[FILTERED]` (in a distinct color when the terminal shows colors), and an unsaved change with the value it had. A Relation prints the SELECT it would send, without sending it: `Relation<User> { sql, params }`.
