---
"@forestfuture/d1-record": patch
---

`d1-record schema` also writes your app's base class once, `src/models/application-record.ts`, as Rails apps have `ApplicationRecord`: `class Product extends ApplicationRecord("products") {}` gets the table's attributes and primary key, typed from the schema. `ApplicationRecord("products", { sku: { default: () => nextSku() }, notes: false })` overrides an attribute's type, nullability or default, or ignores a column (never read or written). `ApplicationRecord({...})` still declares a Model in full. It's built with the library's new `modelFor(tables)`.
