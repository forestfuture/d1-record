---
name: d1-record
description: d1-record (`@forestfuture/d1-record`), a Rails-style Active Record for Cloudflare Workers and D1. Use when writing, reviewing or debugging code that uses it — models, queries, validations, callbacks, associations, batches — or when choosing how to model a D1 database in a Worker.
---

# d1-record

d1-record maps D1 tables to Models and rows to records, as Rails' Active Record does, within what D1 allows: no interactive transactions, atomic batches instead.

## The guide

Read the guide section for the task before writing code. Prefer the copy that ships with the installed package, since it matches the installed version:

- `node_modules/@forestfuture/d1-record/llms-full.txt`: the whole guide, one Markdown file. Its `#` headings are the pages: Getting started, Connecting, Models, Querying, Saving and destroying, Validations, Callbacks, Associations, Batches and bulk writes, D1's limits, Errors, Coming from Rails.
- Online, for the latest release: https://docs.forestfuture.dev/d1-record/llms.txt lists each page as Markdown.

A behavior the guide doesn't cover is specified in `docs/contract.md` in the repository, https://github.com/forestfuture/d1-record.

## Rules

<!-- #region rules -->

This project uses d1-record (`@forestfuture/d1-record`), a Rails-style Active Record for Cloudflare D1. Before writing code with it, read the relevant part of `node_modules/@forestfuture/d1-record/llms-full.txt`, the guide for the installed version.

- Start every query and new record from the request's Database: `const db = connect(env.DB)` once per request, then `db.model(User).where(…)`, `db.model(User).build(…)`. Model classes hold no connection; records keep the Database they came from.
- Name attributes in camelCase everywhere: `where`, `order`, `pluck`, `foreignKey`. Column names (snake_case) appear only inside `sql` fragments.
- Write custom SQL as an `sql` tagged template, which binds every value: ``where(sql`lower(${column("email")}) = ${email}`)``.
- Make several writes atomic with one `db.batch([...])` of statements (`insert`, `updateAll`, `deleteAll`) and records (`record.toSave()`, `record.toDestroy()`). D1 has no interactive transactions, so a read-then-write can't be atomic.
- Generate keys in code (`id: { type: "string", null: false, default: () => crypto.randomUUID() }`) for records that must be linked and saved together: a key D1 generates exists only after its own write.
- Check what saves return: `save()`, `update()` and `destroy()` resolve to `false` when validation fails (reasons in `record.errors`) or a callback aborts (`record.abortReason`). The `…OrThrow` methods throw instead. Constraint errors such as `RecordNotUnique` always throw.
- Give every association a matching `declare` line, typed with the target class: `declare posts: HasMany<typeof Post>`.

<!-- #endregion rules -->

## Shapes to follow

A Model declares its attributes once; TypeScript infers the record's properties from them. Validations and callbacks go in the `static {}` block.

```ts
import { Model, type BelongsTo, type HasMany } from "@forestfuture/d1-record";

export class User extends Model({
  id: { type: "string", null: false, default: () => crypto.randomUUID() },
  email: { type: "string", null: false },
  createdAt: "datetime", // createdAt and updatedAt are set on save
  updatedAt: "datetime",
}) {
  static tableName = "users"; // required

  static associations = this.defineAssociations({
    posts: this.hasMany(() => Post, { dependent: "destroy" }), // foreign key inferred: Post's userId
  });
  declare posts: HasMany<typeof Post>;

  static {
    this.validates("email", { presence: true, uniqueness: true });
  }
}
```

In a Worker, preload associations with `includes` (one query per association), and save a new graph in one call:

```ts
const db = connect(env.DB);
const users = await db
  .model(User)
  .includes("posts")
  .order({ createdAt: "desc" })
  .limit(20)
  .toArray();

const user = db.model(User).build({ email });
user.posts().build({ title: "Hello" }); // saved with the user, in one batch, since the key is generated in code
if (!(await user.save()))
  return Response.json({ errors: user.errors.fullMessages() }, { status: 422 });
```

## Where code goes wrong

- **Uniqueness is a friendly check, not a guarantee.** Two requests can pass it at once; the table's UNIQUE index decides, and the save then throws `RecordNotUnique`. Declare both.
- **Autosave is atomic only with keys generated in code.** With an `INTEGER PRIMARY KEY`, an owner and its built records are written in separate batches, a level at a time.
- **`record.loaded("posts")` reads what was preloaded or already read**, synchronously, and throws `AssociationNotLoaded` otherwise. `await user.posts().toArray()` loads when needed.
- **`find(id)` throws `RecordNotFound`**; `findBy(conditions)` resolves to `null`.
- **After-callbacks run once D1 has committed the write.** An error there reaches the caller with the record already saved: nothing rolls back.
- **Read replicas:** with `connect(env.DB, { session: "first-unconstrained" })`, a request reads its own writes; pass `db.bookmark()` to the next request to keep that across requests.
