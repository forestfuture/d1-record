---
"@forestfuture/d1-record": patch
---

Loading a record reads each stored `datetime` in less than half the time it took, so a row with `createdAt` and `updatedAt` loads in about half the time. The same values load, and the same values throw `TypeError`.
