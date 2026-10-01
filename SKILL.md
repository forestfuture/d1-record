---
name: d1-record
description: d1-record (`@forestfuture/d1-record`), a Rails-style Active Record for Cloudflare D1. Use when writing code with `@forestfuture/d1-record`, or deciding how to model D1 data in a Worker.
---

# d1-record

## Rules

<!-- #region rules -->

d1-record (`@forestfuture/d1-record`) is a Rails-style Active Record for Cloudflare D1. Its guide for the installed version is `node_modules/@forestfuture/d1-record/llms-full.txt`: read the part for the task before writing code with it.

- Start every query and new record from the request's Database: `const db = connect(env.DB)` once per request, then `db.model(User).where(…)`, `db.model(User).build(…)`. Model classes hold no connection; records keep the Database they came from.
- Name attributes in camelCase everywhere: `where`, `order`, `pluck`, `foreignKey`. Column names (snake_case) appear only inside `sql` fragments.
- Write custom SQL as an `sql` tagged template, which binds every value: ``where(sql`lower(${column("email")}) = ${email}`)``.
- Make several writes atomic with one `db.batch([...])` of statements (`insert`, `updateAll`, `deleteAll`) and records (`record.toSave()`, `record.toDestroy()`). D1 has no interactive transactions, so a read-then-write can't be atomic.
- Generate keys in code (`id: { type: "string", null: false, default: () => crypto.randomUUID() }`) for records saved together. An owner whose key is known before its INSERT (generated in code, or already saved) is written in one atomic batch with the records built through it. A key D1 generates exists only after its own write, so each level is then written in a separate batch.
- Declare associations as fields, passing the target class: `posts = hasMany(Post, { dependent: "destroy" })`, `author = belongsTo(User)`. The field's name is the association's name.
- Check what writes return. `save()` and `update()` resolve to `false` when validation fails (reasons in `record.errors`) or a callback aborts (`record.abortReason`). `destroy()` resolves to `false` when a callback aborts, or a `restrictWithError` association refuses (reason in `record.errors`). The `…OrThrow` methods throw instead. Constraint errors, such as `RecordNotUnique`, always throw.

<!-- #endregion rules -->

## More in the guide

The installed package's `llms-full.txt` is one Markdown file, a `#` heading per page. For the latest release instead, https://docs.forestfuture.dev/d1-record/llms.txt lists every page as Markdown, with what each covers. A behavior neither covers is specified in `docs/contract.md` at https://github.com/forestfuture/d1-record.

## Shapes to follow

Models declare their attributes once, and TypeScript infers the record's properties from them. Validations and callbacks go in the `static {}` block:

```ts
import { belongsTo, hasMany, Model } from "@forestfuture/d1-record";

export class User extends Model({
  id: { type: "string", null: false, default: () => crypto.randomUUID() },
  email: { type: "string", null: false },
  createdAt: "datetime", // createdAt and updatedAt are set on save
  updatedAt: "datetime",
}) {
  // Its table, users, is inferred from the class name; static tableName overrides it.
  posts = hasMany(Post, { dependent: "destroy" }); // foreign key inferred: Post's userId

  static {
    this.validates("email", { presence: true, uniqueness: true });
  }
}

export class Post extends Model({
  id: { type: "string", null: false, default: () => crypto.randomUUID() },
  userId: { type: "string", null: false },
  title: { type: "string", null: false },
}) {
  user = belongsTo(User); // foreign key inferred: userId
}
```

A Worker connects per request, preloads associations with `includes`, and saves a new graph in one call:

```ts
import { connect } from "@forestfuture/d1-record";
import { User } from "./models";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const db = connect(env.DB); // once per request

    if (request.method === "GET") {
      // One query for the users, and one for all their posts.
      const users = await db.model(User).includes("posts").order({ createdAt: "desc" }).toArray();
      return Response.json(users);
    }

    const { email } = await request.json<{ email: string }>();
    const user = db.model(User).build({ email });
    user.posts().build({ title: "Hello" }); // saved with the user, in one atomic batch
    if (!(await user.save())) {
      return Response.json({ errors: user.errors.fullMessages() }, { status: 422 });
    }
    return Response.json(user, { status: 201 });
  },
} satisfies ExportedHandler<Env>;
```

## Where code goes wrong

- **Uniqueness validation is a friendly check, not a guarantee.** Two requests can pass it at once; the table's UNIQUE index decides, and the save then throws `RecordNotUnique`. Declare both.
- **`record.loaded("posts")` reads what was preloaded or already read**, synchronously, and throws `AssociationNotLoaded` otherwise. `await user.posts().toArray()` loads when needed.
- **`find(id)` throws `RecordNotFound`**; `findBy(conditions)` resolves to `null`.
- **After-callbacks run once D1 has committed the write.** An error there reaches the caller with the record already saved: nothing rolls back.
- **Read replicas:** a Database opened with a session (`connect(env.DB, { session: "first-unconstrained" })`) reads its own writes. Pass `db.bookmark()` to the next request to keep that across requests.
