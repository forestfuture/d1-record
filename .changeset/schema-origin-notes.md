---
"@forestfuture/d1-record": patch
---

`d1-record schema` recognises migrations written by Drizzle or Prisma and adds notes: those tools can store values differently (numeric timestamps, JSON in plain `TEXT`), so it names each column worth checking against what the generated types say.
