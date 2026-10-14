---
"@forestfuture/d1-record": patch
---

`Model.typeForAttribute(name)` gives an attribute's `cast`, `serialize` and `deserialize`, for SQL d1-record doesn't write. A raw `env.DB.prepare(…).bind(…)` can bind `Post.typeForAttribute("publishedAt").serialize(date)`, which is what the attribute stores (an integer for `storage`, ISO text otherwise), and read a cell back with `deserialize`.
