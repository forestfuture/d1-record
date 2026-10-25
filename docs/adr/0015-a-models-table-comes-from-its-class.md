# A Model extends ApplicationRecord, its table named by its class

Supersedes ADR-0010's "the table is the argument" and the shape in ADR-0011, and amends ADR-0007. A Model extends the app's base class with nothing on the `extends` line: `class Post extends ApplicationRecord {}`. The app's base is a real class, `abstract class ApplicationRecord extends Model { static override schema = schema }`, holding the schema `d1-record schema` generates. A Model's table comes from its class name (`Post` → `posts`) or from `static table`, and its attributes from that table in the schema. Before, a Model called its base with its table (`ApplicationRecord("posts")`), and the base file hid a `Base` class inside `modelFor(tables, Base)`. A reader had to know that `ApplicationRecord` was a function, not a class, before writing a Model.

TypeScript can't give a class a type from its name (ADR-0011), so the types come from generated code instead. `d1-record schema` loads the Model files, as the console does (ADR-0014). The generated schema file then adds each Model's table attributes to its class, with a `declare module` block per Model file. Those blocks are type-only, so the schema still imports nothing at runtime, and nothing imports a Model.

## Considered options

- **Reading columns from D1 when the Worker runs**, with no generated schema: `build()` and casting on assignment would have no columns in a fresh isolate, and types could drift from the live database with nothing to notice.
- **Something to call on the `extends` line** (`ApplicationRecord.table("posts")`, `ApplicationRecord.posts`): a real class, but still a call to learn.
- **A table object** (`Model(posts)`), or **a generated base class per table** (`class Post extends PostRecord {}`): one more name per table.
- **A decorator** (`@table("posts")`): a decorator can't change a class's type.

## Consequences

- **Generation is required, and its absence is loud.** The schema lists the Models it was generated for. A class missing from that list, or whose table changed since, throws `InvalidModel` naming `d1-record schema`, which is what stops a dev server that doesn't type-check. Its statics are a compile error too, as an abstract class's are. `--check` fails when a Model is added or renamed, since the list is part of the file's fingerprint.
- **`schema.ts` changes when Models are added or renamed,** not only with migrations.
- **Overrides live in the class:** `static override attributes = { available: "boolean" } as const`. The generated declarations read their type from the class, so an edit needs no regeneration. A misspelled key is caught at runtime and by `d1-record schema`, not in the editor: a table-aware check from inside the class would refer to itself.
- **A Model's table depends on its class name.** Renaming a class changes its table unless it sets `static table`. A bundler that renames classes is caught by the `models` check (#47 is about not depending on names).
- **The binding is the schema's** (it's generated per binding), so `static binding` is gone. Several databases mean one base class per schema.
- **A class Models are built on is abstract:** the app's base, or a class marked `static abstract = true`. Each class directly below one has its own table, and a subclass of a Model shares its parent's. Callbacks, validations and scopes can be declared on an abstract class.
- **Declaring attributes by hand** is `Model.define({...})`, the renamed `Model({...})` (ADR-0007). It's a static, so `ApplicationRecord.define({...})` builds on the app's base and shares its behavior and binding.
