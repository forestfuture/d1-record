---
"@forestfuture/d1-record": patch
---

The generated `src/db/schema.ts` exports a `Model` bound to its tables: `class Product extends Model("products") {}` gets the table's attributes and primary key, typed from the schema. `Model("products", { sku: { default: () => nextSku() }, notes: false })` overrides an attribute's type, nullability or default, or ignores a column (never read or written). `Model({...})` from the same import still declares a Model in full.
