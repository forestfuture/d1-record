---
"@forestfuture/d1-record": patch
---

`d1-record schema` notes a `DATETIME` column whose default is `CURRENT_TIMESTAMP` or `datetime('now')`, in migrations written by Drizzle or Prisma. That default writes SQLite's date text (`2026-10-12 06:38:30`) where d1-record writes ISO text, and the two sort apart as text.

The Existing databases guide shows a migration that rewrites a column to d1-record's form, and a `strftime` fragment that compares and orders a column holding both.
