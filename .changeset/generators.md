---
"@forestfuture/d1-record": patch
---

Generators: `d1-record g model Product name:string! user:references` writes a `CREATE TABLE` migration and `src/models/product.ts`, and `d1-record g migration AddSkuToProducts sku:string:unique` writes a migration from its name (`Create…`, `Add…To…`, `Remove…From…`, or empty). Columns take `!` for `NOT NULL`, `=value` for a literal default, and `:unique` or `:index`. Each migration is checked against the existing ones before anything is written, numbered as Wrangler numbers them, and the schema is regenerated afterwards.
