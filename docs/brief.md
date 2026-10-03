# Build Brief: a Rails-inspired Active Record for Cloudflare D1

> **Updated 2026-09-23** to reflect the decisions recorded in `docs/adr/` (0001–0007). The detailed behavior is specified in `docs/contract.md`, and the vocabulary in `CONTEXT.md`. Where this brief and those documents differ, they take precedence.

## Your mission

Build a new, production-minded Active Record implementation for **Cloudflare Workers and Cloudflare D1 only**.

The library should make relational application code on Workers feel as natural and expressive as Ruby on Rails Active Record, while remaining honest about the Worker runtime and D1's SQLite-based behavior. Its primary value is not advanced TypeScript inference. Its primary value is an elegant, coherent API and rigorously tested Active Record behavior.

This is **not** an attempt to run the Ruby `ActiveRecord` gem, and it is **not** a portable multi-database ORM. Do not design abstractions for PostgreSQL, MySQL, Node database drivers, or generic SQL dialects. D1 is the platform boundary; SQLite SQL is the query dialect.

## Why this exists

Cloudflare D1 exposes a deliberately low-level asynchronous API: prepare SQL, bind values, execute, and receive rows. That is powerful, but ordinary application code still has to repeatedly solve the same problems:

- map rows to domain models;
- track a model's unsaved changes;
- safely build composable filters;
- define reusable named queries;
- traverse and efficiently load relationships;
- validate before writes;
- expose a predictable persistence lifecycle.

Rails Active Record established a remarkably intuitive vocabulary for those problems. The goal is to bring that vocabulary to Workers without pretending that Workers are Ruby or that D1 is a general-purpose server database.

The desired outcome is code that reads like domain code, not query-construction plumbing.

## Product principles

1. **Rails conventions over Rails imitation.** Match the conceptual API and expected behavior where it improves intuition; adapt names and control flow where JavaScript requires it.
2. **D1-native by design.** Compile directly to SQLite SQL and execute through the `D1Database` binding. Do not place Drizzle or another ORM under the runtime library.
3. **Async is explicit.** Query execution and persistence return promises. A relation remains lazy until a terminal operation is awaited.
4. **Safety by default.** Values must always be parameter-bound. Identifiers and SQL fragments must be explicitly constructed or whitelisted by the library, never interpolated from ordinary values. Hand-written SQL is accepted only through the `sql` tagged template (ADR-0006).
5. **Small, understandable internals.** Prefer a small immutable relation/query AST and SQL compiler over a broad generic ORM framework.
6. **Behavior is the contract.** Test public behavior against real D1-compatible execution, not only mocked query strings.
7. **No premature type-system project.** Supply useful types, but never sacrifice a clear API or runtime correctness to achieve clever inference.

## Runtime facts to respect

- D1 is accessed from a Worker through an asynchronous `D1Database` binding.
- D1 uses SQLite semantics. Schema, functions, query syntax, booleans, dates, and alterations must be D1/SQLite compatible.
- D1 supports prepared statements and positional parameter binding. Every user-supplied value must become a bound parameter.
- `D1Database.batch()` can execute a preconstructed list of statements atomically. It is not equivalent to an arbitrary interactive transaction callback that can issue further statements based on earlier results.
- With D1 read replication, a read after a write may require primary/session routing. Do not silently route a model's immediate post-save reload to an eventually consistent replica.

Design APIs around these truths. Do not hide them behind misleading Rails-shaped promises.

## The user-facing model API

The library should support class-based models with light configuration and normal JavaScript/TypeScript objects.

A **Model** is a class created with `Model({...attributes})`. A **Record** is one instance of a Model: one row, saved or not yet saved. The base class is not called `Record`, because importing a value named `Record` would hide TypeScript's global `Record<K, V>` type (ADR-0001).

Attributes are camelCase in JavaScript and map automatically to snake_case columns in D1 (ADR-0004). Attributes are declared once, in the object passed to `Model({...})`, and TypeScript infers the record's properties from it (ADR-0007). Usually they come from the migrations instead: `d1-record schema` generates `src/db/schema.ts`, whose `Model("products")` gives a Model its table's attributes, with overrides for type, nullability and default, or `false` to ignore a column (ADR-0010). Scopes are declared as a typed static field so that chained calls such as `db.model(User).active()` are type-checked. Associations are declared as record fields, `posts = hasMany(Post)`, so TypeScript infers their accessors (ADR-0008). Validations and callbacks are declared in a `static {}` block.

```ts
import { Model, belongsTo, hasMany, sql } from "@forestfuture/d1-record";

export class User extends Model({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  isActive: "boolean", // column: is_active
  createdAt: "datetime", // column: created_at
  updatedAt: "datetime",
}) {
  static tableName = "users";

  posts = hasMany(Post, { foreignKey: "userId" });

  static scopes = this.defineScopes({
    active: (q) => q.where({ isActive: true }),
    recent: (q) => q.order({ createdAt: "desc" }),
    createdAfter: (q, since: Date) =>
      q.where(sql`created_at > ${since}`),
  });


  static {
    this.validates("email", { presence: true, format: /@/ });
    this.validates("email", { uniqueness: true });
  }
}

export class Post extends Model({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false }, // column: user_id
  title: { type: "string", null: false },
  published: "boolean",
}) {
  static tableName = "posts";

  author = belongsTo(User, { foreignKey: "userId" });

  static scopes = this.defineScopes({
    published: (q) => q.where({ published: true }),
  });


  static {
    this.validates("title", { presence: true });
  }
}
```

Workers must associate models with the D1 binding in a request-safe manner. The only supported shape is an explicit **Database**, created at the application edge for each request (ADR-0003):

```ts
import { connect } from "@forestfuture/d1-record";

export default {
  async fetch(request: Request, env: Env) {
    const db = connect(env.DB);

    const user = await db.model(User).find(42);
    return Response.json(user); // toJSON() returns the attributes
  },
};
```

There is no `User.using(env.DB)` or `User.find(42)`: a binding or session must never be stored on a Model class, where it could leak between concurrent requests. `db.models({ User, Post })` is a convenience that returns the same request-bound facades (`models.User.find(42)`).

## Required API and expected behavior

### Finding and building records

```ts
const user = await db.model(User).find(42);                 // throws RecordNotFound
const maybeUser = await db.model(User).findBy({ email });   // null when absent
const firstUser = await db.model(User).first();             // model or null
const lastUser = await db.model(User).last();               // model or null
const exists = await db.model(User).exists({ isActive: true });

const draft = db.model(User).build({ email: "person@example.com" });
const created = await db.model(User).create({ email: "person@example.com" });
const createdOrThrow = await db.model(User).createOrThrow({ email: "person@example.com" });
```

Desired semantics:

- `build` creates an unsaved record; `isNewRecord()` is true.
- `create` returns an unsaved invalid record when validation fails; errors are available on it.
- `createOrThrow` throws `RecordInvalid` when validation fails.
- `find` throws `RecordNotFound` for an absent primary key; `findBy` returns `null`; `findByOrThrow` throws `RecordNotFound`.
- Hydrated records are persisted and clean. Their primary key and timestamps, where configured, are available after a successful insert.

### Relations: lazy, immutable, composable

```ts
const relation = db.model(User)
  .where({ role: "admin" })
  .whereNot({ suspended: true })
  .order({ createdAt: "desc" })
  .limit(20)
  .offset(40);

const users = await relation.toArray();
const first = await relation.first();
const count = await relation.count();
const emails = await relation.pluck("email");
const selected = await relation.select("id", "email").toArray();
```

Implement at least:

- `where`, including object equality conditions and SQL fragments built with the `sql` tagged template (plain strings are rejected; ADR-0006);
- `whereNot`;
- `order`, `limit`, `offset`;
- `select`, `distinct`;
- `first`, `last`, `take`, `toArray`, `count`, `exists`, `pluck`;
- `find`, `findBy`, and `findByOrThrow`;
- `or` and `merge` for compatible relations;
- `none` as an empty, composable relation.

Each modifier returns a new relation. Constructing or chaining a relation must not query D1. Terminal operations execute it.

Object-style APIs accept only attribute names declared on the model, and an unknown key throws `UnknownAttribute`. Never turn arbitrary object keys into unescaped SQL identifiers. Inside an `sql` fragment, every `${…}` is a bound value. Column names are written as SQL text, or looked up from an attribute with `column("attrName")`.

### Scopes

Scopes are a first-class requirement. They are named relation transformers and must remain lazy and composable.

```ts
await db.model(User).active().recent().toArray();

await db.model(User)
  .where({ role: "admin" })
  .active()
  .createdAfter(new Date("2026-01-01"))
  .toArray();
```

Scopes are declared with `static scopes = this.defineScopes({ … })` so that TypeScript can infer them. The same registered scope should be callable from a model relation, not merely from the root model. Parameterized scopes receive the current relation and their arguments. Their dynamic values must be evaluated when called, rather than at class-definition time.

Implement `defaultScope` and `unscoped` only if their interaction rules are fully documented and tested. If implementation pressure forces a choice, defer default scopes rather than ship surprising behavior.

### Persistence and dirty tracking

```ts
const user = await db.model(User).find(42);

user.email = "new@example.com";
user.changed();                    // ["email"]
user.changedAttributes();          // { email: "old@example.com" }
user.isChanged();                  // true, or an idiomatic equivalent

await user.save();
await user.update({ isActive: false });
await user.updateOrThrow({ isActive: false });
await user.reload();
await user.destroy();
```

Required behavior:

- Saving a new valid record issues an insert; saving a dirty persisted record updates only changed writable columns.
- Saving an unchanged persisted record does not issue a meaningless update unless timestamp semantics explicitly require one.
- A failed validation performs no write and preserves errors and dirty state.
- A successful save clears dirty state and updates `updatedAt` when timestamps are configured.
- `destroy` removes the row and marks the in-memory instance destroyed; attempts to persist a destroyed record have clear, tested behavior.
- `reload` replaces persisted attributes and clears dirty state.
- Rails' bang methods (`save!`, `create!`) are named with an `OrThrow` suffix, because `!` can't appear in a JavaScript identifier (ADR-0005). They throw meaningful domain errors: `saveOrThrow`, `createOrThrow`, `updateOrThrow`, `destroyOrThrow`, `findByOrThrow`. The non-throwing methods follow Rails' return values: `false` (or an unsaved record, for `create`) only for a validation failure or a callback `abort()`. Database constraint errors are always thrown.

Use JavaScript-compatible names. `isChanged()` is preferable to trying to reproduce Ruby's `changed?` exactly. It is acceptable to support aliases such as `isChanged()` if they improve discoverability, but keep one canonical API.

### Validations, errors, and callbacks

Start small and make it reliable.

```ts
class User extends Model({ email: "string", age: "integer" }) {
  static {
    this.validates("email", { presence: true, uniqueness: true });
    this.validates("age", { numericality: { greaterThanOrEqualTo: 13 } });
    this.beforeSave((user) => { user.email = user.email.toLowerCase(); });
    this.afterCreate((user) => audit("user.created", user.id));
  }
}
```

Implement a cohesive initial set:

- `presence`, `inclusion`, `format`, `length`, `numericality`, and `uniqueness` validations;
- an inspectable `errors` collection, including `errors.add`, `errors.get(field)`, and a full error list;
- `await record.isValid()` as the single validation entry point (async, because uniqueness checks query D1);
- `beforeValidation`, `afterValidation`, `beforeSave`, `afterSave`, `beforeCreate`, `afterCreate`, `beforeUpdate`, `afterUpdate`, `beforeDestroy`, and `afterDestroy` only when their timing is unambiguous.

Database constraints remain the final authority. A uniqueness validation is a friendly preflight and must not be advertised as race-safe. Convert recognizable D1 constraint failures into useful library errors where possible.

Callbacks should be deterministic and asynchronous-aware. A pre-write callback cancels the save with `throw abort(reason)`, never by returning `false`. `after*` callbacks run only after a successful persistence lifecycle, and nothing rolls back if they throw.

### Associations and eager loading

```ts
const post = await db.model(Post).find(7);
const author = await post.author();
const posts = await author.posts().published().toArray();

const users = await db.model(User)
  .includes("posts")
  .active()
  .toArray();

for (const user of users) {
  user.loaded("posts"); // synchronous: uses the preloaded association, never queries
}
```

Initial association support:

- `belongsTo`, `hasMany`, and `hasOne`;
- explicit foreign key (an attribute name, such as `userId`) and primary key configuration;
- lazy loading through an async accessor;
- `includes`/preloading that performs bounded queries rather than N+1 queries;
- association relations that support normal scopes and relation methods.

Do not attempt polymorphic associations, counter caches, inverse association inference, or dependent lifecycle strategies in the first release unless they are independently complete and tested.

### Batches, atomicity, and consistency

Expose D1's actual atomic primitive explicitly:

```ts
await db.batch([
  db.model(User).toInsert({ email: "a@example.com" }),
  db.model(AuditLog).toInsert({ action: "user_created" }),
]);
```

This should compile statements first and execute them with `D1Database.batch()`. Do not implement a misleading API such as:

```ts
// Do not promise this unless D1 can truly support it.
await db.transaction(async (tx) => {
  const user = await tx.model(User).create({ ... });
  await tx.model(Post).create({ userId: user.id, ... });
});
```

An interactive transaction callback cannot be faithfully guaranteed by D1's preconstructed batch model. Make this limitation explicit in documentation. A carefully designed unit-of-work API is possible, and d1-record now has one: record statements (`user.toSave()`) in `db.batch([...])`, with autosave (see the contract, *Batches* and *Associations*).

For replica-aware configurations, retain a primary route for writes and immediate read-after-write operations. Prefer a D1 session when the binding/configuration supports it.

## Architecture guidance

Use a small set of focused internal concepts:

1. **Database** — request-safe wrapper around `D1Database`, created with `connect(env.DB)`, with session routing where configured.
2. **Model metadata** — table name, primary key, configured columns, timestamps, validations, callbacks, associations, and registered scopes.
3. **Record instance** — attributes, persisted snapshot, dirty tracking, errors, lifecycle state, and persistence methods.
4. **Immutable Relation** — model plus a query AST (predicates, ordering, selections, joins/preload plan, pagination).
5. **SQLite compiler** — converts a relation or mutation to `{ sql, params }`; owns identifier quoting and parameter ordering.
6. **Hydrator** — turns D1 row objects into model instances and attaches preloaded associations.
7. **Errors** — domain errors such as `RecordNotFound`, `RecordInvalid`, `RecordNotSaved`, and translated constraint violations.

Keep D1 calls at one narrow boundary. Internals should be easy to unit-test with a tiny executor interface, while behavioral integration tests use a real D1-compatible database.

Avoid global mutable state. Worker isolates may serve concurrent requests, and each request's binding/session configuration must remain isolated.

## Testing requirements

This project is behavior-first. Treat tests as part of the product specification.

### Unit tests

Test SQL compilation and API state without a database:

- parameter binding and identifier quoting;
- immutable relation composition;
- scope composition and arguments;
- generated SQL for filters, ordering, null handling, and pagination;
- record dirty snapshots and state transitions;
- validation errors and callback order.

### Integration tests

Run against a real D1-compatible database: Miniflare's D1, driven from Node by `vp test` (ADR-0002; `@cloudflare/vitest-pool-workers` doesn't yet support the Vitest 5 bundled with Vite+). Maintain a small remote D1 smoke suite where practical.

At minimum, prove:

- CRUD behavior and primary-key hydration;
- no SQL injection through values;
- `find` versus `findBy` absence behavior;
- validation failure results in no database write;
- dirty records update only the expected values;
- timestamps update at the documented time;
- scopes are lazy, composable, and preserve earlier filters;
- eager loading avoids N+1 queries;
- D1 foreign-key and unique-constraint failures are handled predictably;
- a failing D1 batch is atomic;
- same-request read-after-write uses the intended consistency path.

Use query-count assertions or an instrumented executor to prove eager-loading behavior. Do not merely test that returned objects look correct.

## Non-goals for the first release

Explicitly defer:

- support for any database other than Cloudflare D1;
- Ruby compatibility or Ruby runtime integration;
- a fully automatic Rails migration framework (migrations are out of scope for this phase);
- arbitrary interactive transactions;
- broad static type inference as a headline feature;
- every Rails association feature, callback, validation, query method, or SQL dialect feature;
- a schema generator that attempts to infer and safely alter every existing database shape.

## Suggested delivery order

Build vertically and keep every stage usable:

1. D1 executor, safe SQLite compiler, model metadata, relation, row hydration.
2. Core read APIs: `find`, `findBy`, `where`, ordering/pagination, and terminal operations.
3. Record lifecycle: build, create, save, update, destroy, reload, timestamps, dirty tracking.
4. Errors and validations, then the core callback lifecycle.
5. Scopes, including parameterized scopes callable from chained relations.
6. `belongsTo`/`hasMany`, followed by reliable eager loading.
7. D1 batch support and primary/session consistency rules.
8. Documentation, examples, performance checks, and remote D1 smoke coverage.

At each stage, write behavior tests before expanding the public API. Resist adding attractive Rails surface area until the smaller surface is correct.

## Acceptance bar

The first usable version is complete when a Worker developer can define `User` and `Post` models, validate and persist instances, compose and reuse scopes, traverse and preload relationships, receive clear errors, and trust the behavior because it is tested against D1.

The library should feel elegant because it is predictable: a relation does not query until asked; a scope is just a reusable relation; a failed validation does not write; an association does not quietly cause N+1 queries when preloaded; and an atomic batch does exactly what D1 guarantees.
