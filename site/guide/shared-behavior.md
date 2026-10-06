---
description: "Write methods, callbacks, and scopes once, on your app's base class, and every Model has them."
---

# Shared behavior

Every Model extends your app’s `ApplicationRecord`, so whatever you write on its base class, every Model has.

## Sharing methods, callbacks, and scopes

Write them on `Base`, in `src/models/application-record.ts`:

<<< @/snippets/guide/application-record.ts#shared{ts}

Each is shared like this:

| On `Base`                                | Every Model                                            |
| ---------------------------------------- | ------------------------------------------------------ |
| A method, such as `label()`              | has it, on every record                                |
| A static method                          | has it, on the Model                                   |
| A callback, in `static {}`               | runs it, before the Model’s own callbacks of that kind |
| A scope, `static newest = this.scope(…)` | has it, as `Product.newest()` and on its Relations     |
| `static override onQuery`                | logs its queries (see [Logging](./logging))            |

A Model can replace a shared method or scope by declaring one of the same name.

::: warning TIP
`d1-record schema` writes `application-record.ts` with commented-out examples to start from.
:::

## Writing for every table

Inside `Base`, `this` is a record of any Model. It has every record method, such as `save()` and `attributes()`, but no attributes, since those differ from table to table:

- Read attributes through `this.attributes()`, as `label()` does above.
- Write shared scopes with `sql` fragments, since they run on each Model’s own table: `static newest = this.scope((q) => q.order(sql\`created_at DESC\`))`.
- Validations name attributes, so they belong on each Model. Put shared checks in a callback instead.

`Base` has no table of its own, so `db.model(Base)` throws `InvalidModel`. Once a Model has been used, its `Base` is sealed with it, so request code can’t add callbacks to every Model.

## Sharing across databases

Each database has its own base class, such as `DbRecord` and `LogsRecord`. To share behavior across all of them, write it in one class extending `Model.Base`, and extend that class in each base class’s file. See [Multiple databases](./several-databases).
