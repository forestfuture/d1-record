---
"@forestfuture/d1-record": patch
---

A `d1-record schema` command generates `src/db/schema.ts` from your D1 migrations: each table's columns as `Model({...})` takes them, by Rails-like conventions (declared types, `…_at` timestamps, `TEXT` keys generated in code, literal defaults). `--check` fails CI when it's out of date, and `--watch` regenerates as you edit migrations. It needs Node 22.13 or later.
