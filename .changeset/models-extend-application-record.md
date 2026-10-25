---
"@forestfuture/d1-record": minor
---

A Model now extends your app’s base class with nothing on the `extends` line: `class Post extends ApplicationRecord {}`. Its table comes from its class name, or `static override table = "…"`, and its attributes from the generated schema. `ApplicationRecord` is an abstract class extending `Model` that holds the schema, and `record instanceof ApplicationRecord` is true.

- `d1-record schema` now loads your Model files too, as the console does, so code at a Model file’s top level runs when it does. Run it after adding or renaming a Model. A Model it hasn’t seen throws `InvalidModel`, and its statics are a compile error. `--check` and `--watch` cover Models.
- Overrides move into the class: `static override attributes = { available: "boolean" } as const`. `declare status: "draft" | "published"` narrows an attribute’s type.
- `static abstract = true` marks a class between `ApplicationRecord` and some Models that shares their behavior.
- Breaking: `modelFor`, `ApplicationRecord("table")`, `Model.Base` (use `Model`), `static binding` (the binding is in the generated schema), and `static tableName` (use `static table`) are gone. `Model({...})` is now `Model.define({...})`, and `ApplicationRecord.define({...})` builds on your base class. Regenerate the schema, and replace `application-record.ts` with the new template.
