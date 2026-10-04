---
"@forestfuture/d1-record": patch
---

`d1-record g model` and `g migration` take `--out`, naming the schema file to regenerate, as `d1-record schema` does: in a Drizzle project with its own `src/db/schema/`, `--out src/db/d1-record.ts`.
