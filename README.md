# d1-record

A Rails-inspired Active Record for [Cloudflare Workers](https://developers.cloudflare.com/workers/) and [D1](https://developers.cloudflare.com/d1/).

Models with validations, callbacks, associations and change tracking; lazy, composable queries; and a predictable save lifecycle, built for the Worker runtime and honest about what D1 can and can't do.

> **Status: pre-release (0.x).** The API is tested against real D1, but it may still change before 1.0.

```sh
npm install @forestfuture/d1-record
```

## A quick look

```ts
import { connect, Model, type BelongsTo, type HasMany } from "@forestfuture/d1-record";

export class User extends Model({
  id: { type: "string", null: false, default: () => crypto.randomUUID() },
  email: { type: "string", null: false },
  isActive: "boolean", // column: is_active
  createdAt: "datetime",
  updatedAt: "datetime",
}) {
  static tableName = "users";

  static associations = this.defineAssociations({
    posts: this.hasMany(() => Post, { foreignKey: "userId", dependent: "destroy" }),
  });
  declare posts: HasMany<typeof Post>;

  static scopes = this.defineScopes({
    active: (q) => q.where({ isActive: true }),
  });

  static {
    this.validates("email", { presence: true, uniqueness: true });
    this.beforeSave((user) => {
      user.email = user.email.toLowerCase();
    });
  }
}

export class Post extends Model({
  id: { type: "integer", null: false },
  userId: { type: "string", null: false },
  title: { type: "string", null: false },
  publishedAt: "datetime",
}) {
  static tableName = "posts";

  static associations = this.defineAssociations({
    author: this.belongsTo(() => User, { foreignKey: "userId" }),
  });
  declare author: BelongsTo<typeof User>;
}

export default {
  async fetch(request: Request, env: { DB: D1Database }) {
    const db = connect(env.DB);

    // Queries are lazy and composable; nothing runs until a terminal method.
    const users = await db
      .model(User)
      .active()
      .includes("posts")
      .order({ createdAt: "desc" })
      .limit(20)
      .toArray();

    // Saving runs validations and callbacks; `false` means invalid or aborted.
    const user = db.model(User).build({ email: "Ada@Example.com" });
    user.posts().build({ title: "Hello, D1" }); // autosaved with the user
    if (!(await user.save())) return Response.json(user.errors.fullMessages(), { status: 422 });

    // Writes that must all happen or none: one atomic D1 batch.
    await db.batch([
      db.model(Post).where({ publishedAt: null }).updateAll({ publishedAt: new Date() }),
      user.destroyStatement(), // its posts too (dependent: "destroy")
    ]);

    return Response.json(users);
  },
};
```

## What's in it

- **Models** declared once with `Model({...})`: typed attributes inferred from the declaration, camelCase attributes over snake_case columns, defaults (including app-generated keys), timestamps, JSON and dates converted both ways.
- **Queries**: `where`/`whereNot`/`or`/`merge`, comparisons (`gte`, `between`, …), ordering (`nulls: "last"`, `reorder`), pagination, `select`, `distinct`, `pluck`, `count`, `size`, `exists`, named scopes, and hand-written conditions only through the `sql` tagged template, so values are always bound.
- **Persistence**: `save`/`create`/`update`/`destroy` with `…OrThrow` variants, validations (`presence`, `length`, `format`, `inclusion`, `numericality`, `uniqueness`), the full Rails callback lifecycle with `abort()`, dirty tracking (`changes`, `attributeWas`, `savedChangeTo`, …).
- **Associations**: `belongsTo`, `hasMany`, `hasOne` with scopes, `dependent:` strategies, preloading with `includes` (one query per association, never N+1), caching until reload, autosave, and `build`/`create`/`set` through the association.
- **Bulk writes**: `insert`, `insertAll`, `upsert`, `updateAll`, `deleteAll`, and `db.batch([...])` mixing those with records' `saveStatement()`/`destroyStatement()`.
- **Read replicas**: `connect(env.DB, { session })` sends every query through one D1 Session, so a request reads its own writes; `db.bookmark()` carries that to the next request.
- **Observability**: `connect(env.DB, { onQuery })` sees every statement with its SQL, bound values, timing and D1's `meta`.

## Honest about D1

d1-record follows Rails wherever D1 allows, and says so where it can't:

- **No interactive transactions.** D1 can't hold a transaction open across `await`s, so there's no `transaction(async tx => …)`. Instead, `db.batch([...])` writes a prepared set of statements and records atomically, and a record with `dependent: "destroy"` or new associated records is written in one batch when its keys are known in advance.
- **Keys generated in code are first-class.** With a `default: () => crypto.randomUUID()`, records can be linked and saved together atomically before D1 has seen them.
- **D1's limits are handled for you.** Lists of any length bind as one value (`json_each`), so the 100-bound-parameter limit never bites; preloads take one query per association.
- **Constraint errors become typed errors** (`RecordNotUnique`, `InvalidForeignKey`, `NotNullViolation`, `CheckViolation`) naming the table, columns and attributes.
- **No request state on Model classes.** Every query goes through the `Database` you `connect()` per request, so concurrent requests on one isolate never share a connection or session.

## How it compares

Query builders such as [Drizzle](https://orm.drizzle.team) and [Kysely](https://kysely.dev) are SQL-first: you write queries against a typed schema, and rows come back as plain objects. d1-record is an Active Record: rows come back as records that know how to validate, save, destroy and load their associations, with the conventions of Ruby on Rails. Its value is a coherent, rigorously tested lifecycle rather than advanced type inference. If you know Rails, you already know most of it.

## Documentation

A documentation site is on its way. Until then:

- [`docs/contract.md`](docs/contract.md): the full public behavior, which the tests prove.
- [`CONTEXT.md`](CONTEXT.md): the domain glossary (Model, Record, Relation, Association, Batch, …).
- [`docs/adr/`](docs/adr/): the architecture decisions and why they were made.

## Development

This project uses [Vite+](https://viteplus.dev) (`vp`) and pnpm. Library code runs on Workers; the tests run a real D1 through Miniflare in Node.

```sh
vp install                # install dependencies (sets up git hooks)
vp check                  # format, lint and type-check
vp test                   # unit and integration tests against a real local D1
vp pack                   # build the library into dist/
vp run check:public-types # after vp pack: the published types expose no internals
vp run test:remote        # the smoke suite against a real remote D1 (see docs/agents/remote-smoke.md)
```

How issues are worked, from agreeing the design to review, is in [`docs/agents/workflow.md`](docs/agents/workflow.md).

## Contributing and security

Ideas and questions are welcome in the [ForestFuture discussions](https://github.com/orgs/forestfuture/discussions). See the organization's [contributing guide](https://github.com/forestfuture/.github/blob/main/CONTRIBUTING.md) and [code of conduct](https://github.com/forestfuture/.github/blob/main/CODE_OF_CONDUCT.md). Please report security problems privately, as described in the [security policy](https://github.com/forestfuture/.github/blob/main/SECURITY.md).

## License

[MIT](LICENSE)
