# Behavior contract (draft)

The public behavior agreed during design, which the tests must prove. It's written to become the basis of the VitePress documentation site later. Terms follow `CONTEXT.md`; the reasons for decisions are in `docs/adr/`.

## Toolchain

- Vite+ `1.0.0-rc.0`, pinned exactly (moving to 1.0.0 once released). pnpm 12.6.0 through `devEngines`. Node 24 LTS through `.node-version`.
- Single package `d1-record`, ESM-only, target ES2022, `.d.ts` emitted, attw `esm-only` profile and publint on every `vp pack`. `"private": true` until we decide to publish. MIT license.
- `src/` is type-checked with `@cloudflare/workers-types` and no Node types. `tests/tsconfig.json` adds Node types.
- Two Vitest projects. `unit` (`tests/unit/**`) runs against a fake executor that records queries. `integration` (`tests/integration/**`) gets a fresh in-memory Miniflare D1 per file, with the schema created from `tests/fixtures/schema.sql` (`tests/support/d1.ts`, Miniflare 4). See ADR-0002.
- Pre-commit hooks lint and format staged files. GitHub Actions runs `vp install`, `vp check`, `vp test` and `vp pack` on push to `main`.

## Connecting

```ts
const db = connect(env.DB); // plain binding: every query goes to the primary
const db = connect(env.DB, { session: "first-unconstrained" | "first-primary" | bookmark });
db.bookmark(); // pass to the next request
const users = db.model(User); // request-bound model facade (canonical)
const models = db.models({ User, Post }); // convenience: models.User has the same type as db.model(User)
```

- A Database with a session sends every query through that one session, so the request reads its own writes. Apps that want a primary Database and a replica Database call `connect()` twice.
- No request state is ever stored on a Model class (ADR-0003).
- Every record keeps the Database it was built or loaded through. Records come only from `build()`, `create()` or a query. A record constructed directly with `new User()` throws `NoDatabase` on any operation that needs D1.

## Declaring a Model

```ts
class User extends Model {
  static tableName = "users"; // required; no inference
  static primaryKey = "id"; // default

  declare id: string;
  declare email: string;
  declare createdAt: Date;

  static scopes = this.defineScopes({
    active: (q) => q.where({ isActive: true }),
    createdAfter: (q, since: Date) => q.where(sql`${column("createdAt")} > ${since}`),
  });

  static {
    this.attribute("id", "string", { default: () => crypto.randomUUID() });
    this.attribute("email", "string");
    this.attribute("htmlUrl", "string", { column: "html_url" });
    this.attribute("createdAt", "datetime");
    this.validates("email", { presence: true, uniqueness: true });
    this.beforeSave((u) => {
      u.email = u.email.toLowerCase();
    });
  }
}
```

- Attributes are camelCase and map automatically to snake_case columns, with a per-attribute `column` override (ADR-0004).
- Attribute properties are prototype accessors typed with `declare`. A class field that hides an accessor (`email!: string`) is detected the first time the Model is used, and throws.
- Types: `string`, `integer`, `real`, `boolean` (0/1), `datetime` (a `Date`, stored as ISO-8601 TEXT), `json` (stored as TEXT). Attributes can be null by default.
- Defaults are evaluated at `build()`, so app-generated keys (UUID, CUID, ULID) exist before saving and can be used to link rows inside one `batch()`.
- If the database generates the primary key, `RETURNING *` fills it in on insert.
- Timestamps are on when `createdAt`/`updatedAt` are declared as `datetime` attributes. They're set in JavaScript just before the write is compiled. Explicit values on create are kept.
- Keys that aren't declared attributes throw `UnknownAttribute` in `build`, `create`, `update` and `where`.

## Inheritance and serialization

- A subclass inherits a copy of its parent's attributes, validations, callbacks, scopes and associations. Declaring more on the child never changes the parent. An abstract base (`static abstract = true`) has no `tableName`. Single-table inheritance is out of scope.
- `attributes()` returns a plain object of loaded camelCase attributes with JavaScript values. `toJSON()` returns the same object, but with a `Date` as an ISO string, so `Response.json(user)` works. Associations are never included automatically.

## Change tracking

- Change detection compares each attribute's current serialized value with the value last loaded or saved, so in-place changes to `json` values and `Date`s are detected.
- `isChanged()`, `changed()` → `["email"]`, `changedAttributes()` → `{ email: old }`, `changes()` → `{ email: [old, new] }`.
- `savedChanges()` holds the changes from the last successful save. Use it in `after*` callbacks, where the record is already clean.

## Associations

```ts
class User extends Model {
  static associations = this.defineAssociations({
    posts: this.hasMany(() => Post, { foreignKey: "userId" }),
    profile: this.hasOne(() => Profile, { foreignKey: "userId" }),
  });
  declare posts: HasMany<Post>;
  declare profile: HasOne<Profile>;
}
```

- `belongsTo`, `hasMany` and `hasOne`. `foreignKey` is always explicit and names an attribute. `primaryKey` defaults to the target Model's primary key.
- Each instance accessor needs a matching `declare`. Without one, TypeScript reports a missing-property error. A shipped type test checks that `declare`s match `associations`.
- `await post.author()` resolves to `User | null`, and `await user.profile()` to `Profile | null`. `user.posts()` returns a Relation that supports scopes and every Relation method.
- Preloaded associations resolve without a query: `await user.posts().toArray()` and `await post.author()`. Chaining further (`user.posts().published()`) queries as normal.
- `user.loaded("posts")` returns preloaded data synchronously and throws `AssociationNotLoaded` if it wasn't preloaded.
- `includes("posts")`, `includes("posts", "profile")` and nested `includes({ posts: "comments" })` load each association in its own `WHERE fk IN (…)` query. Keys are deduplicated and split into groups of 100, D1's limit on bound parameters per query, so preloading N parents takes ⌈N/100⌉ queries per association. Query-count tests prove this.
- Polymorphic associations, counter caches, inverse inference and `dependent` strategies are out of scope.

## Persistence results

| Method                                   | Resolves to                           | Domain errors                                         |
| ---------------------------------------- | ------------------------------------- | ----------------------------------------------------- |
| `save()` / `update(attrs)`               | `true` / `false`                      | constraint errors, `RecordDestroyed`                  |
| `saveOrThrow()` / `updateOrThrow(attrs)` | `true`                                | same as above, plus `RecordInvalid`, `RecordNotSaved` |
| `create(attrs)`                          | record, persisted or not              | constraint errors                                     |
| `createOrThrow(attrs)`                   | persisted record                      | same as above, plus `RecordInvalid`, `RecordNotSaved` |
| `destroy()`                              | destroyed record, or `false` on abort | constraint errors, `RecordDestroyed`                  |
| `destroyOrThrow()`                       | destroyed record                      | same as above, plus `RecordNotDestroyed`              |
| `find(id)`                               | record                                | `RecordNotFound`                                      |
| `findBy(conds)`                          | record or `null`                      | none                                                  |
| `findByOrThrow(conds)`                   | record                                | `RecordNotFound`                                      |

Any error thrown by a callback other than an `abort(...)` propagates unchanged. That includes an error from an `after*` callback after the persistence lifecycle has already succeeded. Operational D1 errors always propagate. `false` means only "validation failed" or "a callback aborted" (ADR-0005).

## Constraint errors

- `RecordNotUnique`, `InvalidForeignKey`, `NotNullViolation` and `CheckViolation` are recognised from D1 error messages. They carry the original error as `cause`, and `.table`, `.columns` and `.attributes` where the message names them (SQLite's foreign-key message doesn't name a column).
- Both the throwing and non-throwing methods throw them. After a constraint error the dirty attributes are kept and `errors` is not changed, because nothing was persisted.
- Uniqueness validation is a friendly early check, not race-safe. The database constraint has the final say.

## Validation

`await record.isValid()` is the only public entry point. It clears `errors`, runs `beforeValidation`, runs the synchronous and asynchronous validators (uniqueness reads D1), runs `afterValidation`, and returns `true`/`false`. It catches `abort()` and returns `false`; every other error propagates. `save()` and `saveOrThrow()` call it internally. `isChanged()` is a pure synchronous state check, while `isValid()` does work and may query D1.

## Errors collection

```ts
record.errors.add("email", "is invalid", { type: "invalid" }); // type defaults to "invalid"
record.errors.add("base", "Account is locked");
record.errors.get("email"); // ["is invalid"] (always an array)
record.errors.fullMessages(); // ["Email is invalid"]; createdAt displays as "Created at"
record.errors.toArray(); // [{ attribute, type, message }]
record.errors.isEmpty();
record.errors.size;
```

Validators add entries with a `type` (`"blank"`, `"taken"`, `"tooShort"`, …) and a default English message. No i18n in the first release.

## Validators

All validators accept `allowNull`, `message` and `if: (record) => boolean`.

- `presence`: not null, and not blank after trimming a string. For a boolean, use `inclusion: [true, false]`.
- `length`: `{ minimum, maximum, is }`.
- `format`: `{ with: /re/ }`, or `format: /re/` as shorthand.
- `inclusion`: `{ in: [...] }`, or an array as shorthand.
- `numericality`: `{ onlyInteger, greaterThan, greaterThanOrEqualTo, lessThan, lessThanOrEqualTo }`.
- `uniqueness`: `{ scope: [...], caseSensitive }`. It leaves out the record itself when updating and runs `SELECT 1 … LIMIT 1` through the record's Database (so the same session). `caseSensitive: false` compiles to `lower(col) = lower(?)`, and SQLite's `lower()` only lowercases ASCII letters.

## Callback lifecycle

```text
beforeValidation → validators → afterValidation
→ beforeSave → beforeCreate | beforeUpdate
→ D1 write (skipped when a persisted record is still clean)
→ record becomes persisted and clean
→ afterCreate | afterUpdate → afterSave
```

- `after*` callbacks run after a **successful persistence lifecycle**, which isn't necessarily a D1 write. Saving a clean persisted record runs every callback, issues no UPDATE and leaves `updatedAt` unchanged, as in Rails. If a `before*` callback changes an attribute, the record is dirty again and the UPDATE happens.
- An `after*` callback that changes the record makes it dirty again, and no second write happens automatically.
- Nothing rolls back after a successful write.

## Abort

```ts
this.beforeSave((account) => {
  if (account.suspended) throw abort("Account is suspended");
});
```

- `abort(reason)` returns a unique `CallbackAbort` sentinel, and only that exact sentinel is caught. Returning `false` never halts anything.
- It only takes effect in `beforeValidation`, `afterValidation`, `beforeSave`, `beforeCreate`, `beforeUpdate` and `beforeDestroy`.
- `save()` returns `false`, does no write, and keeps the dirty and new-record state. `saveOrThrow()` throws `RecordNotSaved` with the reason. `destroy()` returns `false`, and `destroyOrThrow()` throws `RecordNotDestroyed`.
- `record.abortReason` holds the reason. It's cleared at the start of each `isValid()`, `save()` and `destroy()`, and never copied into `errors`.
- An `abort()` in `afterSave`, `afterCreate`, `afterUpdate` or `afterDestroy` becomes `AbortAfterPersistence`, which records the callback name, the reason and the original `CallbackAbort` as `cause`. The persisted or destroyed state stays as it is.

## Lifecycle state

| State                                            | `isNewRecord()` | `isPersisted()` | `isDestroyed()` |
| ------------------------------------------------ | --------------- | --------------- | --------------- |
| New (from `build()`, or after a failed `create`) | `true`          | `false`         | `false`         |
| Persisted (loaded, or after a successful save)   | `false`         | `true`          | `false`         |
| Destroyed (after a successful `destroy()`)       | `false`         | `false`         | `true`          |

## Destroyed records

- A record is marked destroyed only after the D1 `DELETE` succeeds, and before `afterDestroy` runs. If `afterDestroy` throws, the row stays deleted and the record stays destroyed.
- `isDestroyed()` is `true` and `isPersisted()` is `false`. Attributes stay readable.
- `save`, `saveOrThrow`, `update`, `destroy` and `reload` throw `RecordDestroyed`.

## Relations

- Every modifier returns a new Relation. Building a Relation never queries D1.
- `where({ x: null })` → `"x" IS NULL`. `where({ x: [1, 2] })` → `"x" IN (?, ?)`. `where({ x: [] })` → `1 = 0`. `whereNot({ x: [] })` → `1 = 1`. `where({ x: [1, null] })` → `("x" IN (?) OR "x" IS NULL)`.
- `whereNot` wraps the whole condition: `whereNot({ a, b })` → `NOT ("a" = ? AND "b" = ?)`. Following SQL semantics, `whereNot({ role: "admin" })` also excludes NULL roles. `whereNot({ role: null })` → `"role" IS NOT NULL`.
- Hand-written conditions must be `sql` tagged templates (ADR-0006): ``where(sql`${column("createdAt")} > ${since}`)``. Plain strings are rejected.
- `first()` and `last()` with no order sort by the primary key ascending or descending. `last()` reverses every direction of an explicit order. `take()` adds no ordering.
- `find()`, `findBy()` and `findByOrThrow()` keep the Relation's where conditions and scopes, ignore its order, limit, offset and `select()`, and always load full rows.
- `or()`: same Model, and the same select, order, limit and offset. Only where conditions may differ, and each side is wrapped in parentheses. Otherwise it throws `IncompatibleRelation`.
- `merge()`: same Model only. Where conditions combine with AND. For order, limit, offset and select, a clause the argument sets explicitly replaces the receiver's, and a clause it doesn't set leaves the receiver's alone. Orders are replaced, not concatenated, which is a deliberate difference from Rails. Merging across Models throws `IncompatibleRelation`.

## Terminal operations

- `toArray`, `first`, `last`, `take`, `find`, `findBy`, `findByOrThrow`.
- `pluck("email")` resolves to converted values. `pluck("id", "email")` resolves to tuples.
- `count()` gives `COUNT(*)`, or `COUNT(DISTINCT "email")` with `select("email").distinct()`. `count("email")` counts non-null values.
- `exists(conds?)` issues `SELECT 1 … LIMIT 1`.
- `none()` never touches D1: `toArray` gives `[]`, `count` gives `0`, `exists` gives `false`, `first`/`last`/`take`/`findBy` give `null`, `pluck` gives `[]`, and `find` throws `RecordNotFound`. Chaining keeps it `none()`. `none().or(r)` and `r.or(none())` both return `r`.

## Partial records

- `select()` on a Model Relation accepts only declared attributes. The primary key is always selected.
- Reading an unloaded attribute throws `MissingAttribute`, including when a validator or callback reads it. Setting one is allowed and makes it loaded and dirty.
- `save()` writes only changed attributes (plus `updatedAt`), and never fills in unloaded ones. `reload()` loads the full row.

## Batches

- `db.batch([...])` runs D1's atomic `batch()` with statements built beforehand by `db.model(X).insert(...)`, `updateAll(...)` and `deleteAll()`. These skip validations, callbacks and hydration. Record-aware batching is deferred.
- There's no interactive `transaction(async tx => …)`, because D1 can't guarantee it.
- A single statement runs on its own with `await stmt.run()`, which resolves to D1's `meta`.
- Neither Relations nor statements are awaitable directly (they have no `then`), so an `async` function that returns one never runs it by accident.

## Instrumentation

- `connect(env.DB, { onQuery(event) })` is called once per statement, batches included, with `{ sql, params, durationMs, meta, error? }`. The integration tests' query-count checks use this same hook. No logger is built in.

## Errors

Everything extends `D1RecordError`:

- **Lifecycle:** `RecordNotFound`, `RecordInvalid` (`.record`), `RecordNotSaved`, `RecordNotDestroyed`, `RecordDestroyed`, `AbortAfterPersistence`
- **Usage:** `UnknownAttribute`, `MissingAttribute`, `IncompatibleRelation`, `AssociationNotLoaded`, `NoDatabase`
- **Constraints:** `RecordNotUnique`, `InvalidForeignKey`, `NotNullViolation`, `CheckViolation`
