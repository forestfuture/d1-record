---
"@forestfuture/d1-record": patch
---

`d1-record schema` never replaces a file it didn't write, and never writes `src/db/schema.ts` beside a `src/db/schema/` folder (a common Drizzle layout), whose imports it would take over. Either is an error suggesting `--out src/db/d1-record.ts`; the generators check it before writing anything.
