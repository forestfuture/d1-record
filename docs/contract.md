# Behavior contract (draft)

The public behavior agreed during design, which the tests must prove. It's written to become the basis of the VitePress documentation site later. Terms follow `CONTEXT.md`; the reasons for decisions are in `docs/adr/`.

## Toolchain

- Vite+ `1.0.0-rc.0`, pinned exactly (moving to 1.0.0 once released). pnpm 12.6.0 through `devEngines`. Node 24 LTS through `.node-version`.
- Single package `@forestfuture/d1-record` (scoped, published with `access: public`), ESM-only, target ES2022, `.d.ts` emitted, attw `esm-only` profile and publint on every `vp pack`. `"private": true` until we decide to publish. MIT license.
- `src/` is type-checked with `@cloudflare/workers-types` and no Node types. `tests/tsconfig.json` adds Node types.
- Two Vitest projects. `unit` (`tests/unit/**`) is for logic that needs no database. There's no fake executor: tests that involve D1 use the real Miniflare D1 and watch queries through the public `onQuery` hook. `integration` (`tests/integration/**`) gets a fresh in-memory Miniflare D1 per file, with the schema created from `tests/fixtures/schema.sql` (`tests/support/d1.ts`, Miniflare 4). See ADR-0002.
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
class User extends Model({
  id: { type: "string", null: false, default: () => crypto.randomUUID() },
  email: { type: "string", null: false },
  isActive: "boolean", // column: is_active
  htmlUrl: "string", // column: html_url (acronyms are handled)
  legacyId: { type: "integer", column: "person_identifier" },
  createdAt: "datetime",
  updatedAt: "datetime",
}) {
  static tableName = "users"; // required; no inference
  static primaryKey = "id"; // default

  static scopes = this.defineScopes({
    active: (q) => q.where({ isActive: true }),
    createdAfter: (q, since: Date) => q.where(sql`created_at > ${since}`),
  });

  static {
    this.validates("email", { presence: true, uniqueness: true });
    this.beforeSave((u) => {
      u.email = u.email.toLowerCase();
    });
  }
}
```

- Attributes are declared once, in the object passed to `Model({...})`, and TypeScript infers the instance properties from it: no `declare`, no second declaration (ADR-0007). An entry is either a type name or `{ type, column?, null?, default? }`.
- Attributes are camelCase and map automatically to snake_case columns (ADR-0004), using Rails' `underscore` rule, which treats a run of capitals as one word: `createdAt` → `created_at`, `externalAccountId` → `external_account_id`, `htmlURL` → `html_url`, `userID` → `user_id`, `sha256Hash` → `sha256_hash`. `column` overrides the mapping for one attribute.
- Types: `string`, `integer`, `real`, `boolean` (0/1), `datetime` (a `Date`, stored as ISO-8601 TEXT), `json` (stored as TEXT). As in SQLite, an attribute can be null unless it's declared `null: false`, and its TypeScript type includes `| null` to match.
- Attribute properties are prototype accessors. The first time a Model is used, `db.model(X)` throws `InvalidModel` if it has no `tableName`, if a class field hides an accessor (e.g. `email!: string` in the class body), or if an attribute is named like a record method (`attributes`, `save`, `constructor`, …). Rename such an attribute and map it with `{ column }`.
- SQL fragments are SQL, so they use column names (``sql`created_at > ${since}` ``), or `column("createdAt")` to look the column up from the attribute (ADR-0006).
- `db.model(X).build(attrs)` makes a new record without querying. Before an attribute is assigned, it reads as `null`. Defaults are evaluated at `build()` (a default returning `undefined` throws `TypeError`, as for any assignment), so app-generated keys (UUID, CUID, ULID) exist before saving and can be used to link rows inside one `batch()`.
- A record built or created from a Relation starts with that Relation's single equality values: `where({ role: "admin" }).build()` has `role: "admin"`. Arrays, `whereNot`, `or` and `sql` fragments carry nothing over, and explicit attributes win.
- `record.assign(attrs)` assigns several attributes without saving. `update(attrs)` is `assign` then `save`. An unknown key throws `UnknownAttribute` and an `undefined` value throws `TypeError` (use `null` to store NULL), in `build`, `create`, `assign`, `update`, and when setting a property (`user.email = undefined`).
- An insert writes only **assigned** attributes: given to `build`/`create`, set through a property, or filled by a `default`. Anything else is left out, so the column's database default applies. `RETURNING *` then loads what D1 actually stored, including generated keys and defaults.
- An update writes only the attributes that changed. A save with nothing changed sends no statement. Changing the primary key is allowed, and the UPDATE finds the row by the key as last loaded or saved.
- If the row is already gone (e.g. another request deleted it), `save` and `destroy` still succeed. `reload()` throws `RecordNotFound`, since there's nothing to load, and so does reloading a record that was never saved.
- Timestamps are on when `createdAt`/`updatedAt` are declared as `datetime` attributes. They're set in JavaScript (`new Date()`) just before the write is compiled: both on insert, and `updatedAt` on an update that changes something. A clean save leaves `updatedAt` alone. A timestamp assigned explicitly is kept.
- Keys that aren't declared attributes throw `UnknownAttribute` in `build`, `create`, `update` and `where`, and are compile errors where the types can see them.

## Inheritance, shared behavior and serialization

- A subclass (`class Admin extends User`) inherits a copy of its parent's attributes, validations, callbacks, scopes and associations. Declaring more on the child never changes the parent. Single-table inheritance is out of scope.
- Share behavior between Models with plain functions called from `static {}` (e.g. `audited(this)`), not with an app-wide base class. A `.with({...})` helper for adding attributes to a subclass of a shared base can be added later if needed.
- `attributes()` returns a plain object of loaded camelCase attributes with JavaScript values. `toJSON()` returns the same object, but with a `Date` as an ISO string, so `Response.json(user)` works. Associations are never included automatically.

## Change tracking

- Change detection compares each attribute's current serialized value with the value last loaded or saved, so in-place changes to `json` values and `Date`s are detected.
- `isChanged()`, `changed()` → `["email"]`, `changedAttributes()` → `{ email: old }`, `changes()` → `{ email: [old, new] }`.
- `savedChanges()` holds the changes from the last **successful** save (`{}` after a clean save). After `create`, that's everything the new row holds, including what D1 filled in (the generated key, column defaults), each changed from `null`. A failed save doesn't change it. `changes()` and `savedChanges()` return copies, so editing the record afterwards never alters them. Use it in `after*` callbacks, where the record is already clean.
- A new record's changes are its assigned attributes, each changed from `null`.

## Associations

```ts
class User extends Model({ id: { type: "integer", null: false } }) {
  static associations = this.defineAssociations({
    posts: this.hasMany(() => Post, { foreignKey: "userId" }),
    profile: this.hasOne(() => Profile, { foreignKey: "userId" }),
  });
  declare posts: HasMany<Post>;
  declare profile: HasOne<Profile>;
}
```

- `belongsTo`, `hasMany` and `hasOne`. `foreignKey` is always explicit and names an attribute. `primaryKey` defaults to the target Model's primary key.
- Each association accessor still needs a matching `declare` (attributes don't; see ADR-0007). Without one, TypeScript reports a missing-property error. A shipped type test checks that `declare`s match `associations`.
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

- `RecordNotUnique`, `InvalidForeignKey`, `NotNullViolation` and `CheckViolation`, all subclasses of `ConstraintViolation`, are recognised from D1 error messages on insert, update and delete. They carry the original error as `cause`, and `.table`, `.columns` and `.attributes` where the message names them (SQLite's foreign-key message doesn't name a column).
- Both the throwing and non-throwing methods throw them. After a constraint error the caller's own changes are kept and `errors` is not changed, because nothing was persisted. Timestamps are only applied once D1 accepts a write, so a failed save doesn't leave `createdAt`/`updatedAt` behind.
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

- A record is marked destroyed only after the D1 `DELETE` succeeds, and before `afterDestroy` runs. Destroying a never-saved record sends nothing, since there's no row, and marks it destroyed. If `afterDestroy` throws, the row stays deleted and the record stays destroyed.
- `isDestroyed()` is `true` and `isPersisted()` is `false`. Attributes stay readable, but the record is read-only: setting a property or calling `assign` throws `RecordDestroyed`.
- `save`, `saveOrThrow`, `update`, `destroy` and `reload` throw `RecordDestroyed`.
- A keyless record from `select(...).distinct()` has no identity to write by, so the same methods throw `MissingAttribute`. A record constructed directly (`new User()`) has no Database, so they throw `NoDatabase`.

## Relations

- Every modifier returns a new Relation. Building a Relation never queries D1.
- `static primaryKey` (default `"id"`) must name a declared attribute, or `db.model(X)` throws `InvalidModel`. `find(id)` takes one id, a `string | number`. Several ids are tracked in #12.
- An empty conditions object (`where({})`, `whereNot({})`, `findBy({})`) adds no condition. An `undefined` value throws `TypeError`: use `null` to match NULL, or leave the key out. `undefined` would otherwise bind NULL and silently match nothing.
- `where({ x: null })` → `"x" IS NULL`. `where({ x: [1, 2] })` → `"x" IN (?, ?)`. `where({ x: [] })` → `1 = 0`. `whereNot({ x: [] })` → `1 = 1`. `where({ x: [1, null] })` → `("x" IN (?) OR "x" IS NULL)`.
- `whereNot` wraps the whole condition: `whereNot({ a, b })` → `NOT ("a" = ? AND "b" = ?)`. Following SQL semantics, `whereNot({ role: "admin" })` also excludes NULL roles. `whereNot({ role: null })` → `"role" IS NOT NULL`.
- Hand-written conditions must be `sql` tagged templates (ADR-0006): ``where(sql`${column("createdAt")} > ${since}`)``. Plain strings are rejected with a `TypeError` (and are compile errors). Values interpolated into a fragment have no declared type, so a `Date` is bound as ISO text and a boolean as 1/0, matching how attributes are stored.
- `order({ createdAt: "desc", id: "asc" })` sorts by each key in turn, and repeated calls append. NULLs sort as SQLite sorts them (first in ascending order). `limit`/`offset` page, and `offset` works without a `limit`.
- `first()` and `last()` with no order sort by the primary key ascending or descending. With `limit`/`offset`, `first`, `last`, `take` and `exists` work within that page (so `limit(0)` has none). `last()` reverses every direction of an explicit order. `take()` adds no ordering.
- `find()`, `findBy()` and `findByOrThrow()` keep the Relation's where conditions and scopes, ignore its order, limit, offset and `select()`, and always load full rows.
- `or()`: same Model, and the same select, order, limit, offset and distinct. Only where conditions may differ, and each side is wrapped in parentheses. Otherwise it throws `IncompatibleRelation`.
- `merge()`: same Model only. Where conditions combine with AND. For order, limit, offset, select and distinct, a clause the argument sets explicitly replaces the receiver's, and a clause it doesn't set leaves the receiver's alone. Orders are replaced, not concatenated, which is a deliberate difference from Rails. Merging across Models throws `IncompatibleRelation`.

## Terminal operations

- `toArray`, `first`, `last`, `take`, `find`, `findBy`, `findByOrThrow`.
- `pluck("email")` resolves to converted values. `pluck("id", "email")` resolves to tuples.
- `count()` counts over the whole query as a subquery, so it always equals the number of rows `toArray()` would return, including `limit`, `offset`, `select` and `distinct` (with `select("role").distinct()`, NULL counts as one distinct value). `count("role")` counts non-null values, and after `distinct()` it compiles to `COUNT(DISTINCT "role")`, the distinct non-null values.
- `exists(conds?)` issues `SELECT 1 … LIMIT 1`.
- `none()` never touches D1: `toArray` gives `[]`, `count` gives `0`, `exists` gives `false`, `first`/`last`/`take`/`findBy` give `null`, `pluck` gives `[]`, and `find` throws `RecordNotFound`. Chaining keeps it `none()`. `none().or(r)` and `r.or(none())` both return `r`.

## Partial records

- `select()` on a Model Relation accepts only declared attributes. The primary key is always loaded too, so a partial record keeps its identity, except after `distinct()`, where adding the key would make every row distinct. Such records carry only the selected attributes.
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
- **Usage:** `InvalidModel` (a problem in a Model's declaration, detected the first time it's used), `UnknownAttribute`, `MissingAttribute`, `IncompatibleRelation`, `AssociationNotLoaded`, `NoDatabase`
- **Constraints:** `ConstraintViolation`, with subclasses `RecordNotUnique`, `InvalidForeignKey`, `NotNullViolation` and `CheckViolation`
