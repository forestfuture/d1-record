---
"@forestfuture/d1-record": patch
---

`d1-record schema` notes a `DATETIME` column whose default is `CURRENT_TIMESTAMP` or `datetime('now')`, in migrations written by Drizzle or Prisma: that default writes SQLite's date text (`2026-10-12 06:38:30`), d1-record writes ISO text, and a column holding both orders as text. The Existing databases guide shows how to compare such a column with `strftime`, and a migration that makes the rows match.
