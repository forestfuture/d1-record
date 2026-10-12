---
"@forestfuture/d1-record": patch
---

A stored date with no time zone, as SQLite's `DEFAULT CURRENT_TIMESTAMP` writes it (`2026-10-12 06:38:30`), now reads as UTC. It was read in the process's time zone, so in Node outside UTC (the console, scripts, tests) it came back hours off. Workers were unaffected, as they run in UTC.
