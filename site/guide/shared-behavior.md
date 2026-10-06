---
description: "Write methods, callbacks, and scopes once, on your app's base class, and every Model has them, as with Rails' ApplicationRecord."
---

# Shared behavior

Every Model extends your app’s `ApplicationRecord`, so what you write on its base class, `Base` in `src/models/application-record.ts`, every Model has. `d1-record schema` writes that file with commented-out examples to start from.

<<< @/snippets/guide/models.ts#shared{ts}

What `Base` can declare, and how each one is shared:

| On `Base`                                | Every Model                                            |
| ---------------------------------------- | ------------------------------------------------------ |
| A method, such as `label()`              | has it, on every record                                |
| A static method                          | has it, on the Model                                   |
| A callback, in `static {}`               | runs it, before the Model’s own callbacks of that kind |
| A scope, `static newest = this.scope(…)` | has it, as `Product.newest()` and on its Relations     |
| `static override onQuery`                | logs its queries (see [Logging](./logging))            |

A Model can replace a shared method or scope by declaring one of the same name.

## What `Base` can see

Inside `Base`, `this` is a record of any Model. It has every record method (`save()`, `attributes()`, `changes()`, …) but no attributes, since those differ from table to table:

- Read attributes through `this.attributes()`, as `label()` does above.
- Write shared scopes with `sql` fragments, since they run on each Model’s own table: `static newest = this.scope((q) => q.order(sql\`created_at DESC\`))`.
- Validations name attributes (`this.validates("email", …)`), so they belong on each Model. Put shared checks in a callback instead.

`Base` has no table of its own: `db.model(Base)` throws `InvalidModel`. And once a Model has been used, its `Base` is sealed along with it, so request code can’t add callbacks to every Model.

## Several databases

Each database has its own base class (`DbRecord`, `LogsRecord`), in its own file. To share behavior across all of them, write it in one class extending `Model.Base`, and extend that class in each base class file. See [Multiple databases](./several-databases).
