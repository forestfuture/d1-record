---
"@forestfuture/d1-record": patch
---

Generated ids: choose how your app's keys are made in one place. `static override generateId = () => uuidv7()` on your app's base class makes every attribute declared with `generateId: true`, where a default would run (at `build()`, and in bulk inserts); it's `crypto.randomUUID()` by default, and gets the attribute's name. `d1-record schema` now writes `generateId: true` for a `TEXT` primary key instead of `default: () => crypto.randomUUID()`, and its format changed, so run `d1-record schema` again: `--check` reports the old file as stale. A Model can turn it on or off with an override (`{ publicId: { generateId: true } }`). The generated `application-record.ts` shows a commented-out example.
