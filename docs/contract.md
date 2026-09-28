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

- A Database with a session sends every query through that one D1 Session: record reads and writes, uniqueness checks, association reads, preloads, statements and batches. So the request reads its own writes even when reads are served by replicas. `session` takes D1's own values: `"first-primary"`, `"first-unconstrained"`, or a bookmark. Apps that want a primary Database and a replica Database call `connect()` twice.
- `db.bookmark()` is the Session's latest bookmark (D1's `getBookmark()`), `null` before its first query. Pass it to the next request's `connect(env.DB, { session: bookmark })` to read at least as new as this request wrote. On a Database opened without a session it throws `NoSession`, since a `null` there would quietly mean "no session" next time.
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
- `db.model(X).build(attrs)` makes a new record without querying. Before an attribute is assigned, it reads as `null`. Defaults are evaluated at `build()` (a default returning `undefined` throws `TypeError`, as for any assignment), so app-generated keys (UUID, CUID, ULID) exist before saving.
- A record built or created from a Relation starts with that Relation's single equality values: `where({ role: "admin" }).build()` has `role: "admin"`. Arrays, `whereNot`, `or` and `sql` fragments carry nothing over, and explicit attributes win.
- `record.assign(attrs)` assigns several attributes without saving. `update(attrs)` is `assign` then `save`. An unknown key throws `UnknownAttribute` and an `undefined` value throws `TypeError` (use `null` to store NULL), in `build`, `create`, `assign`, `update`, and when setting a property (`user.email = undefined`).
- An insert writes only **assigned** attributes: given to `build`/`create`, set through a property, or filled by a `default`. Anything else is left out, so the column's database default applies. `RETURNING *` then loads what D1 actually stored, including generated keys and defaults.
- An update writes only the attributes that changed. A save with nothing changed sends no statement. Changing the primary key is allowed, and the UPDATE finds the row by the key as last loaded or saved.
- If the row is already gone (e.g. another request deleted it), `save` and `destroy` still succeed. `reload()` throws `RecordNotFound`, since there's nothing to load, and so does reloading a record that was never saved.
- Timestamps are on when `createdAt`/`updatedAt` are declared as `datetime` attributes. They're set in JavaScript (`new Date()`) just before the write is compiled: both on insert, and `updatedAt` on an update that changes something. A clean save leaves `updatedAt` alone. A timestamp assigned explicitly is kept.
- Keys that aren't declared attributes throw `UnknownAttribute` in `build`, `create`, `update` and `where`, and are compile errors where the types can see them.

## Scopes

- Declared with `static scopes = this.defineScopes({ name: (q, ...args) => q… })`. A scope receives the current Relation and its arguments and returns a changed Relation of the **same Model on the same Database**; anything else throws `TypeError` naming the scope, so a query never silently moves to another connection.
- Callable on `db.model(X)` and on any Relation of that Model, and chainable with everything: `db.model(User).where(…).active().createdAfter(d).order(…)`. Chained scope calls are typed: a wrong argument type or an unknown scope name is a compile error.
- Calling a scope never queries. A scope's arguments, and anything it computes such as `new Date()`, are evaluated when it's called, not when the class is defined.
- Inside a scope body, `q` has every Relation method but not the Model's other scopes (their types would refer to themselves). To reuse logic, share a plain function between scopes.
- A subclass has its parent's scopes plus its own, and a same-named scope replaces the parent's. The parent never gains the subclass's scopes. A subclass that declares no scopes keeps its parent's types; one that declares its own should spread its parent's to keep them typed: `this.defineScopes({ ...User.scopes, admins: … })`. Only `defineScopes` inherits: a plain `static scopes = { … }` replaces the parent's scopes entirely.
- A scope can't use any name a Relation already has: its methods (`where`, `count`, …), the standard object ones (`constructor`, `toString`, …), or `then`, which would make Relations awaitable. `db.model(X)` throws `InvalidModel` for such a name.
- Scopes are fixed once a Model is used: replacing `scopes` afterwards makes `db.model(X)` throw `InvalidModel`.
- Default scopes and `unscoped` are deferred (#25).

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
  static tableName = "users";
  static associations = this.defineAssociations({
    posts: this.hasMany(() => Post, { foreignKey: "userId" }),
    profile: this.hasOne(() => Profile, { foreignKey: "userId" }),
  });
  declare posts: HasMany<typeof Post>;
  declare profile: HasOne<typeof Profile>;
}

class Post extends Model({ id: "integer", userId: "integer" }) {
  static tableName = "posts";
  static associations = this.defineAssociations({
    author: this.belongsTo(() => User, { foreignKey: "userId" }),
  });
  declare author: BelongsTo<typeof User>;
}
```

- `belongsTo`, `hasMany` and `hasOne`, declared with `static associations = this.defineAssociations({...})`. The target is a thunk (`() => Post`), so Models can point at each other.
- `foreignKey` is always explicit and names an attribute: the owner's for `belongsTo`, the target's for `hasMany`/`hasOne`. `primaryKey` is the attribute the foreign key points at. It defaults to the target's primary key for `belongsTo`, and the owner's for `hasMany`/`hasOne`. Keys aren't type-checked (typing them makes Models that point at each other circular). They're checked when the Model is first used, as are an association named like an attribute or a record method/property, and a target that isn't a Model: all `InvalidModel`.
- Each association accessor needs a matching `declare`, naming the target **class** (`HasMany<typeof Post>`) so association Relations keep the target's scopes. Without one, TypeScript reports a missing property. Inferring the accessors instead is deferred (#15).
- `await post.author()` and `await user.profile()` resolve to a record or `null`. `user.posts()` returns a lazy Relation of the target, with its scopes and every Relation method. All three query through the owner's Database. Without a query: `belongsTo` resolves to `null` when its foreign key is `null`, and `hasOne`/`hasMany` resolve to `null`/an empty Relation when the owner has no key (it's unsaved, or its key attribute is `null`). A `belongsTo` on an unsaved record whose foreign key is set loads the target, as in Rails.
- A loaded association is cached on the record, as in Rails: `await post.author()` and `await user.profile()` query once (a `null` result included), and `await user.posts().toArray()` loads the collection once, in target primary-key order. Preloading with `includes` fills the same cache. Each cached value remembers the key it was loaded for, so changing a foreign key (`post.userId = 2`) makes the next read query again, preloaded or not. `reload()` clears the cache; `save()` keeps it. `await record.reloadAssociation("author")` queries again, replaces what's cached and returns it (Rails' `reload_author`, and `user.posts.reload`).
- Records built or created through `user.posts()` get the owner's key. On an unsaved owner, `build` is allowed (the key is `null`, so save the owner first), while `create`/`createOrThrow` throw `RecordNotSaved`, as in Rails. Autosave is deferred (#29).
- `includes("posts", "profile")` and nested `includes({ posts: "comments" })` or `includes({ posts: ["comments", "tags"] })` preload associations for every record loaded, by `toArray`, `first`, `last`, `take`, `find` and `findBy`. Names are typed from the `declare` lines, and an unknown one throws `UnknownAssociation`. Each association is loaded with its own `WHERE key IN (…)` query per group of 100 distinct keys (D1's limit on bound parameters), so N parents take ⌈N/100⌉ queries per association, never one per record. Keys preloading needs are loaded even if `select` leaves them out; since adding them would undo a `distinct`, `includes` with `select(...).distinct()` throws `IncompatibleRelation`. `includes` on `none()` sends nothing. Models reached only through `includes` are checked and prepared like any other.
- On a loaded `hasMany`, `toArray`, `first`, `last`, `take` and `pluck` answer from the loaded records without a query. `count` always queries, like Rails' `count` (`size` is #34). Chaining further (`user.posts().published()`, …) queries as normal and doesn't change the cache. `create` through a loaded `hasMany` appends the new record, as in Rails. `insert`, `updateAll` and `deleteAll` built through it clear the cache, and `build` doesn't append (autosave is #29). A record destroyed some other way stays in an owner's cached collection until it's reloaded, as in Rails. Without a scope, a loaded `hasMany`'s records are in target primary-key order, and `hasOne` (lazy or preloaded) picks the matching record with the lowest primary key.
- `record.loaded("posts")` returns a loaded association synchronously (records for a `hasMany`, a record or `null` otherwise), typed from the `declare`. A list is returned as a copy. It throws `AssociationNotLoaded` unless the association was preloaded or already read, for the key the record holds now. `record.isLoaded("posts")` is the predicate (Rails' `association(:posts).loaded?`).
- `or()` needs the same `includes`, and `merge()` combines both sides' includes.
- A subclass has its parent's associations plus its own (spread `...Parent.associations` to keep them typed, as with scopes). Replacing `associations` after a Model's first use throws `InvalidModel`.
- `user.posts().insert(attrs)`, `updateAll(...)` and `deleteAll()` build statements (see _Batches_). As in Rails' `has_many`, `deleteAll()` on the association itself deletes the records when its `dependent:` is `"destroy"` or `"deleteAll"`, and otherwise sets their foreign key to `NULL` (a NOT NULL foreign key raises `NotNullViolation`). Once narrowed (`user.posts().where(...)`, `.limit(…)`, a scope), `deleteAll()` deletes, as a Rails association relation does. For an owner without a key, `insert` throws `RecordNotSaved`, and `updateAll`/`deleteAll` match nothing.
- An association can declare a scope, as Rails' `has_many :posts, -> { order(created_at: :desc) }`: `this.hasMany(() => Post, { foreignKey: "userId", scope: (q) => q.order({ createdAt: "desc" }) })`, on `hasMany`, `hasOne` and `belongsTo`. `q` is the target's Relation with its named scopes. Like the keys, it isn't typed, so Models can point at each other; it's checked when the scope first runs (`UnknownAttribute`, and `TypeError` if the scope doesn't return a Relation of the target). Annotate it (`(q: Relation<Post>) => …`) for full typing.
- The scope applies to lazy reads and to preloads alike. A `hasMany`'s records come in the scope's order, then by primary key, and a `hasOne` takes the first by the scope's order. Records built or created through the association take the scope's equality values, so `scope: (q) => q.where({ published: true })` creates published posts. `deleteAll()` and `updateAll()` through it only touch the scope's records. A scope using `limit`, `offset` or `distinct` works for lazy reads, but preloading it throws `IncompatibleRelation`, because a grouped preload would apply them to every owner's records together (Rails gives silently wrong results here).
- `dependent:` sets what destroying the owner does to an association's records, as in Rails: `"destroy"`, `"deleteAll"`, `"nullify"`, `"restrictWithException"` or `"restrictWithError"` on a `hasMany`, and the same with `"delete"` in place of `"deleteAll"` on a `hasOne` (its first record, by the scope's order or the primary key). `belongsTo` has none; a strategy the kind doesn't have is a type error and an `InvalidModel`. `"destroyAsync"` waits for a job library (#35).
- Strategies run when a persisted owner is destroyed, after its `beforeDestroy` callbacks and before its DELETE, so an abort leaves the records alone. (Rails runs them where the association is declared among the callbacks, so an abort declared later comes too late.) Restrictions are checked first, so a restricted owner touches nothing:
  - `"restrictWithException"` throws `DeleteRestriction` ("Cannot delete record because of dependent posts") while there are records.
  - `"restrictWithError"` adds a `base` error instead ("Cannot delete record because dependent posts exist", or "…because a dependent profile exists"), so `destroy()` returns `false` and `destroyOrThrow()` throws `RecordNotDestroyed`.
  - `"deleteAll"`, `"delete"` and `"nullify"` are statements sent in one `batch()` with the owner's DELETE, so all of it happens or none of it does. Callbacks on the records don't run, as in Rails.
  - `"destroy"` runs each record's destroy lifecycle, with its callbacks and its own dependents, before the owner's DELETE. D1 can't make that atomic: if a record's destroy aborts, the owner's destroy throws `RecordNotDestroyed`, and the records already destroyed stay destroyed.
- Without a strategy, destroying an owner whose records point at it leaves the database to decide: D1 enforces foreign keys, so it throws `InvalidForeignKey`. Polymorphic associations, counter caches and inverse inference are out of scope.

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

- `RecordNotUnique`, `InvalidForeignKey`, `NotNullViolation` and `CheckViolation`, all subclasses of `ConstraintViolation`, are recognised from D1 error messages on insert, update and delete. They carry the original error as `cause`, and `.table`, `.columns` and `.attributes` where the message names them (SQLite's foreign-key and check messages don't name a column). The same errors come from statements and batches. `.table` is the table D1's message names, and `.attributes` are mapped when that table is one being written to (a trigger's write to another table leaves them empty). When the message names no table (foreign-key and check failures), it's the only table written to. A batch that writes to several then has `.table` `null`, and the message starts with `batch:`.
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

Declared in `static {}` with `this.validates(attribute, rules)`. The attribute name and the `if` callback's record are typed against the Model. Every declared validation runs, in declaration order, with no stopping at the first failure, so one attribute can collect several errors. Within one `validates` call the rules apply in a fixed order: presence, length, format, inclusion, numericality, uniqueness.

All validators accept `allowNull` (skip when the value is null), `message` (replaces every default message from that call) and `if: (record) => boolean`. Without `allowNull`, a null value fails `presence`, `format`, `inclusion` and `numericality`. `length` counts it as length 0 (so it fails a `minimum` or `is`, and passes a `maximum`), and `uniqueness` never treats it as taken.

Default messages (Rails' English): `blank` "can't be blank", `tooShort` "is too short (minimum is N characters)", `tooLong` "is too long (maximum is N characters)", `wrongLength` "is the wrong length (should be N characters)", `invalid` "is invalid", `inclusion` "is not included in the list", `notANumber` "is not a number", `notAnInteger` "must be an integer", `greaterThan`/`greaterThanOrEqualTo`/`lessThan`/`lessThanOrEqualTo` "must be greater than (or equal to) N" / "must be less than (or equal to) N", `taken` "has already been taken".

- `presence`: not null, and not blank after trimming a string. For a boolean, use `inclusion: [true, false]`.
- `length`: `{ minimum, maximum, is }`.
- `format`: `{ with: /re/ }`, or `format: /re/` as shorthand.
- `inclusion`: `{ in: [...] }`, or an array as shorthand.
- `numericality`: `{ onlyInteger, greaterThan, greaterThanOrEqualTo, lessThan, lessThanOrEqualTo }`, or `true`. Only real numbers pass: a numeric string such as `"12"` is `notANumber`, so convert form input first.
- `uniqueness`: `{ scope: [...], caseSensitive }`. It leaves out the record itself when updating and runs `SELECT 1 … LIMIT 1` through the record's Database (so the same session). `null` is never taken, matching SQLite's UNIQUE, which allows any number of NULLs. `caseSensitive: false` compiles to `lower(col) = lower(?)`, and SQLite's `lower()` only lowercases ASCII letters.

## Callback lifecycle

Declared in `static {}`: `this.beforeValidation(fn)`, `afterValidation`, `beforeSave`, `beforeCreate`, `beforeUpdate`, `afterCreate`, `afterUpdate`, `afterSave`, `beforeDestroy`, `afterDestroy`. Each takes a function that receives the record, typed as the Model's record, and may be async; callbacks of one kind run in declaration order. A subclass runs its parent's callbacks and validations plus its own, and declaring on it never changes the parent. Declarations belong in the class's `static {}` block: once a Model has been used (`db.model(X)`), declaring on it throws `InvalidModel`, so request code can never add callbacks that leak into later requests.

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

- `abort(reason)` returns a `CallbackAbort` (a `D1RecordError`; the reason defaults to "Aborted by a callback"), and only that class is caught. Returning `false` never halts anything.
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
- `static primaryKey` (default `"id"`) must name a declared attribute, or `db.model(X)` throws `InvalidModel`. `find(id)` takes one id, a `string | number`, and resolves to a record. `find(1, 2)` or `find([1, 2])` resolves to an array in the ids' order, or in the Relation's order if it has one, as in Rails. It's one query, repeated ids are found once, `find([])` resolves to `[]`, and a missing id throws `RecordNotFound` saying how many were found. Ids are cast to the key's type first, as in Rails, so `"01"` and `1` are the same id for an integer key. Unlike Rails, `find(1, 1)` still resolves to an array, so the return type follows the arguments. More than 100 ids exceed D1's limit on bound parameters, as with `where` (#31).
- An empty conditions object (`where({})`, `whereNot({})`, `findBy({})`) adds no condition. An `undefined` value throws `TypeError`: use `null` to match NULL, or leave the key out. `undefined` would otherwise bind NULL and silently match nothing.
- `where({ x: null })` → `"x" IS NULL`. `where({ x: [1, 2] })` → `"x" IN (?, ?)`. `where({ x: [] })` → `1 = 0`. `whereNot({ x: [] })` → `1 = 1`. `where({ x: [1, null] })` → `("x" IN (?) OR "x" IS NULL)`.
- Comparisons: `where({ age: gte(18) })`, `gt`, `lt`, `lte`, and `where({ createdAt: between(start, end) })`, which includes both ends like Rails' `start..end`. `between(start, end, { excludeEnd: true })` is `start <= x < end`, like `start...end`. `gte` and `lte` are also Rails' endless and beginless ranges. The value is converted like the attribute's own, so dates compare by time, and its type must be the attribute's. Only number, string and datetime attributes can be compared: a comparison on a boolean or `json` attribute is a type error, and throws `TypeError`. A comparison with `null` or `undefined` throws `TypeError`: use `where({ x: null })` to match NULL. Comparisons are values of their own class, so a `json` attribute's object value (`{ gt: 1 }`) still means equality. A record built from the Relation doesn't take a comparison's value.
- `whereNot` wraps the whole condition: `whereNot({ a, b })` → `NOT ("a" = ? AND "b" = ?)`. Following SQL semantics, `whereNot({ role: "admin" })` also excludes NULL roles. `whereNot({ role: null })` → `"role" IS NOT NULL`.
- Other hand-written conditions must be `sql` tagged templates (ADR-0006): ``where(sql`lower(${column("email")}) = ${email}`)``. Plain strings are rejected with a `TypeError` (and are compile errors). Values interpolated into a fragment have no declared type, so a `Date` is bound as ISO text and a boolean as 1/0, matching how attributes are stored.
- `order({ createdAt: "desc", id: "asc" })` sorts by each key in turn, and repeated calls append. NULLs sort as SQLite sorts them (first in ascending order) unless placed: `order({ role: { direction: "asc", nulls: "last" } })` compiles to `NULLS LAST`. An expression is an `sql` fragment: ``order(sql`lower(${column("email")})`)``, with the direction inside it. Plain strings throw `TypeError`. `reorder(spec)` replaces the order so far, as in Rails, and `reorder()` removes it. `limit`/`offset` page, and `offset` works without a `limit`.
- `first()` and `last()` with no order sort by the primary key ascending or descending. With `limit`/`offset`, `first`, `last`, `take` and `exists` work within that page (so `limit(0)` has none). `last()` reverses every direction of an explicit order, and moves placed NULLs to the other end, as Rails' `reverse_order` does. It can't reverse an `sql` fragment, so it throws `IrreversibleOrder` (Rails' `IrreversibleOrderError`). That is stricter than Rails, which flips a plain string order such as `"name DESC"` and only raises for ones it can't parse (function calls, NULLS placement). A fragment is a template with bound values, and reversing it would mean parsing SQL. `take()` adds no ordering.
- `find()`, `findBy()` and `findByOrThrow()` keep the Relation's where conditions, scopes and includes, ignore its limit, offset and `select()`, and always load full rows. They ignore its order too, except that `find` with several ids returns them in the Relation's order when it has one (see above).
- `or()`: same Model on the same Database, and the same select, order (fragments compare by text and values), limit, offset and distinct. Only where conditions may differ, and each side is wrapped in parentheses. Otherwise it throws `IncompatibleRelation`.
- `merge()`: same Model on the same Database only. Where conditions combine with AND. For order, limit, offset, select and distinct, a clause the argument sets explicitly replaces the receiver's, and a clause it doesn't set leaves the receiver's alone. Orders are replaced, not concatenated, which is a deliberate difference from Rails. An argument built with `reorder()` replaces the order even when its own is empty, as in Rails. Merging across Models throws `IncompatibleRelation`.

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

```ts
const userId = crypto.randomUUID(); // ids generated in code link rows inside one batch
await db.batch([
  db.model(User).insert({ id: userId, email: "a@example.com" }),
  db.model(Post).insert({ userId, title: "Hello" }),
  db.model(Post).where({ published: false }).deleteAll(),
]);
await db.model(Post).where({ id: postId }).updateAll({ published: true }).run();
await db
  .model(Post)
  .updateAll(sql`${column("views")} = ${column("views")} + ${1}`)
  .run();
```

- A **Statement** is a write compiled when it's built: `relation.insert(attrs)`, `relation.updateAll(changes)` or `relation.deleteAll()`. It skips validations, callbacks and hydration, and runs on the Database it was built from. Unknown attributes, `undefined` values and plain strings throw when it's built.
- `await stmt.run()` runs one statement and resolves to D1's `meta` (`changes`, `last_row_id`, `duration`, …).
- `db.batch([...])` runs statements atomically with D1's `batch()`: all of them are written, or none. It resolves to each statement's `meta`, in order. `[]` resolves to `[]` without a query. A statement from another Database rejects with `IncompatibleRelation`.
- There's no interactive `transaction(async tx => …)`. D1 can't hold a transaction open across awaits, so a callback that reads and then decides what to write can't be made atomic; a batch of statements built beforehand can. Record-aware batching (saving records in a batch) is deferred (#16).
- `insert(attrs)` writes one row. Declared attribute defaults fill attributes that aren't given (unlike Rails' `insert_all`, because in D1 app-side defaults are where keys are generated), and `createdAt`/`updatedAt` are set unless given, as Rails does. A Relation's equality conditions are inserted too, as with `build()`. A constraint failure throws, as everywhere (ADR-0005).
- `insertAll(rows)` inserts several rows in one statement (Rails' `insert_all!`), and throws on a duplicate, writing nothing. Every row must have the same attributes (`TypeError` otherwise, and for `[]`), and defaults, timestamps and a Relation's equality values apply to each row. The rows are bound as one JSON value (`INSERT … SELECT … FROM json_each(?)`), so any number of rows fits in one statement, within D1's 100 bound parameters and its 2 MB limit on one value.
- `insert(attrs, { onDuplicate: "skip" })` and `insertAll(rows, { onDuplicate: "skip" })` skip rows that clash with a unique index (`ON CONFLICT DO NOTHING`). Skipping is opt-in: Rails' `insert` and `insert_all` skip by default, which ADR-0005 rules out.
- `upsert(attrs)` and `upsertAll(rows)` update a row that clashes with the unique index on `uniqueBy`, which is the primary key by default or names another unique index's attributes. As in Rails, every given attribute is updated except the `uniqueBy` ones and `createdAt`, and `updatedAt` is set. Rails' `returning` and `update_only` options are deferred (#36).
- `updateAll(changes)` takes an object of declared attributes (converted like any write) or an `sql` fragment, and leaves `updatedAt` alone, as in Rails. `{}` throws `TypeError`.
- Which rows `updateAll`/`deleteAll` write follows Rails. With a `limit` or `offset`, it's `WHERE <primary key> IN (SELECT <primary key> … ORDER BY … LIMIT … OFFSET …)`, so the Relation's order picks the rows. Otherwise it's the Relation's conditions, and `order`, `select` and `includes` don't matter. `distinct()` throws `IncompatibleRelation`.
- A `none()` Relation's statement is still sent, as `WHERE 1 = 0`, and reports `changes: 0`. Rails sends nothing, but a statement's result is D1's `meta`, which only D1 can give.
- Neither Relations nor statements are awaitable directly (they have no `then`), so an `async` function that returns one never runs it by accident.

## Instrumentation

- `connect(env.DB, { onQuery(event) })` is called once per statement, batches included, with `{ sql, params, durationMs, meta, error? }`. The integration tests' query-count checks use this same hook. No logger is built in.
- In a batch, each statement's `durationMs` is D1's own timing for it (`meta.duration`). When a batch fails, D1 doesn't say which statement failed, so every statement is reported with the error and the batch's elapsed time. `event.error` is D1's own error; the caller gets the translated `ConstraintViolation`, with D1's error as its `cause`.

## Errors

Everything extends `D1RecordError`:

- **Lifecycle:** `RecordNotFound`, `RecordInvalid` (`.record`), `RecordNotSaved`, `RecordNotDestroyed`, `RecordDestroyed`, `CallbackAbort` (from `abort()`), `AbortAfterPersistence` (`.callback`, `.reason`)
- **Usage:** `UnknownAssociation`, `InvalidModel` (a problem in a Model's declaration, detected the first time it's used), `UnknownAttribute`, `MissingAttribute`, `IncompatibleRelation`, `IrreversibleOrder`, `DeleteRestriction`, `AssociationNotLoaded`, `NoDatabase`, `NoSession`
- **Constraints:** `ConstraintViolation`, with subclasses `RecordNotUnique`, `InvalidForeignKey`, `NotNullViolation` and `CheckViolation`
