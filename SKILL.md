---
name: d1-record
description: d1-record (`@forestfuture/d1-record`), a Rails-style Active Record for Cloudflare D1. Use when writing code with `@forestfuture/d1-record`, or deciding how to model D1 data in a Worker.
---

# d1-record

## Rules

<!-- #region rules -->

d1-record (`@forestfuture/d1-record`) is a Rails-style Active Record for Cloudflare D1. Its guide for the installed version is `node_modules/@forestfuture/d1-record/llms-full.txt`: read the part for the task before writing code with it.

- Create tables with the generators, never by hand-declaring attributes: `npx d1-record g model Post user:references 'title:string!'` writes the migration and the Model; `npx d1-record g migration AddSlugToPosts slug:string:unique` writes a change. Apply them with `npx wrangler d1 migrations apply <db> --local`. After a hand-written migration, run `npx d1-record schema`. Never edit the generated `src/db/schema.ts`.
- A Model extends the app's base class, naming its table: `class Post extends ApplicationRecord("posts")`. Its attributes come from the schema, so it declares only behavior. Change how a column is read with an override, `ApplicationRecord("posts", { metadata: "json" })`, never by editing the schema.
- Start queries and new records from the Model, as in Rails: `User.find(id)`, `User.where(…)`, `User.build(…)`. Each Model queries its binding (`static override binding = "DB"`, usually on the app's base class) during a request. For a D1 Session, per-request `onQuery`, or tests and scripts outside a Worker, wrap the code once in `withDatabase(connect(env.DB, { … }), fn)`. Records keep the database they came from.
- Never pass a request's whole body, form or query string to a Model: name the fields, with destructuring or `User.permit(await request.json(), "email", "name")` (it reads `FormData` and `URLSearchParams` too). Assigned values are checked against the attribute's type, but that doesn't stop a user setting `role` or `isAdmin`. Check a request value's type before querying with it: `findBy({ token: null })` matches rows whose token is NULL.
- Name attributes in camelCase everywhere: `where`, `order`, `pluck`, `foreignKey`. Column names (snake_case) appear only inside `sql` fragments.
- Write custom SQL as an `sql` tagged template, which binds every value: ``where(sql`lower(${column("email")}) = ${email}`)``.
- Bulk writes run when called: `await posts.deleteAll()` and `updateAll(…)` resolve to how many rows; `insert(…)` to D1's `meta`. Make several writes atomic with one `batch([...])` of their `to…` forms (`toInsert`, `toUpdateAll`, `toDeleteAll`, …) and records' `toSave()`/`toDestroy()`. D1 has no interactive transactions, so a read-then-write can't be atomic.
- Keep the generators' `TEXT` keys, generated in code, for records saved together (`--id integer` gives a key D1 generates instead). An owner whose key is known before its INSERT (generated in code, or already saved) is written in one atomic batch with the records built through it. A key D1 generates exists only after its own write, so each level is then written in a separate batch.
- To change how those keys are made (UUIDv7, ULID, a prefix), override `static generateId` once on the app's base class; don't give each Model's key a `default`. `generateId` sees only the attribute's name, so a value made from other attributes (a slug) goes in a callback.
- Declare associations as fields, passing the target class: `posts = hasMany(Post, { dependent: "destroy" })`, `author = belongsTo(User)`. The field's name is the association's name.
- Check what writes return. `save()` and `update()` resolve to `false` when validation fails (reasons in `record.errors`) or a callback aborts (`record.abortReason`). `destroy()` resolves to `false` when a callback aborts, or a `restrictWithError` association refuses (reason in `record.errors`). The `…OrThrow` methods throw instead. Constraint errors, such as `RecordNotUnique`, always throw.

<!-- #endregion rules -->

## More in the guide

The installed package's `llms-full.txt` is one Markdown file, a `#` heading per page. For the latest release instead, https://docs.forestfuture.dev/d1-record/llms.txt lists every page as Markdown, with what each covers. A behavior neither covers is specified in `docs/contract.md` at https://github.com/forestfuture/d1-record.

## Shapes to follow

Generated Models extend `ApplicationRecord`, with their attributes from the schema. Associations are fields, scopes are statics, and validations and callbacks go in the `static {}` block:

```ts
import { belongsTo, hasMany } from "@forestfuture/d1-record";
import { ApplicationRecord } from "./application-record";

export class User extends ApplicationRecord("users") {
  posts = hasMany(Post, { dependent: "destroy" }); // foreign key inferred: Post's userId

  static active = this.scope((q) => q.where({ isActive: true }));

  static {
    this.validates("email", { presence: true, uniqueness: true });
  }
}

export class Post extends ApplicationRecord("posts") {
  user = belongsTo(User); // foreign key inferred: userId
}
```

A Worker queries from its Models, preloads associations with `includes`, and saves a new graph in one call:

```ts
import { User } from "./models";

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "GET") {
      // One query for the users, and one for all their posts.
      const users = await User.includes("posts").order({ createdAt: "desc" }).toArray();
      return Response.json(users);
    }

    const { email } = await request.json<{ email: string }>();
    const user = User.build({ email });
    user.posts().build({ title: "Hello" }); // saved with the user, in one atomic batch
    if (!(await user.save())) {
      return Response.json({ errors: user.errors.fullMessages() }, { status: 422 });
    }
    return Response.json(user, { status: 201 });
  },
} satisfies ExportedHandler<Env>;
```

## Where code goes wrong

- **`onQuery` listeners see filtered attributes' values as `"[FILTERED]"`**: passwords, tokens, keys and emails, by Rails' default list. Add names to `static filterAttributes` on the app's base class for other secrets. Values inside `sql` fragments aren't filtered.
- **Uniqueness validation is a friendly check, not a guarantee.** Two requests can pass it at once; the table's UNIQUE index decides, and the save then throws `RecordNotUnique`. Declare both.
- **`record.loaded("posts")` reads what was preloaded or already read**, synchronously, and throws `AssociationNotLoaded` otherwise. `await user.posts().toArray()` loads when needed.
- **Page a list with `paginate()`, not a hand-built `limit` and `offset`**: `Post.published().paginate({ page: url.searchParams.get("page") })` casts the untrusted page, caps its size at `static maxPerPage`, and sends the count with the page in one round trip. `{ count: false }` skips the `COUNT`, which reads (and bills) every matching row.
- **`find(id)` throws `RecordNotFound`**; `findBy(conditions)` resolves to `null`.
- **After-callbacks run once D1 has committed the write.** An error there reaches the caller with the record already saved: nothing rolls back.
- **Read replicas:** a request run in `withDatabase(connect(env.DB, { session: "first-unconstrained" }), fn)` reads its own writes. Pass that database's `db.bookmark()` to the next request to keep that across requests.
- **Outside a Worker** (tests, scripts) there's no binding to find: run the code in `withDatabase(connect(binding), fn)`, or a query throws `NoDatabase` saying so. A query at a module's top level fails too: Workers only allow D1 calls during a request.
