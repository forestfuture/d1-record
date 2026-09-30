---
description: "save, create, update and destroy, their OrThrow variants, what each returns or throws, lifecycle state and reload."
---

# Saving and destroying

## Saving

`save()` validates the record, runs its callbacks and writes it: an INSERT for a new record, or an UPDATE of just the changed attributes for a persisted one. It resolves to `true`, or `false` when the record wasn't saved, for one of two reasons:

- **Validation failed.** The reasons are in `record.errors`.
- **A callback aborted** with [`abort()`](./callbacks#stopping-a-save-with-abort). The reason is in `record.abortReason`, and `errors` is left alone.

<<< @/snippets/guide/persistence.ts#save{ts}

`create(attrs)` is `build` then `save`, and resolves to the record whether it saved or not. Check `isPersisted()` or `errors`. `update(attrs)` is `assign` then `save`.

## Or throw

Each has an `OrThrow` version for when a failure is exceptional (Rails' `save!`, `create!`, …). Instead of returning `false`, it throws:

- `RecordInvalid` when validation failed, with the record on `error.record`.
- `RecordNotSaved` when a callback aborted a save, with the abort's reason as its message.
- `RecordNotDestroyed` from `destroyOrThrow()`, when a callback aborted the destroy or a `restrictWithError` association refused it.

<<< @/snippets/guide/persistence.ts#or-throw{ts}

## What each method returns

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

`false` only ever means "validation failed" or "a callback aborted". The domain errors in the table are d1-record's own. Everything else throws too, from both kinds of method:

- **Constraint errors** such as `RecordNotUnique` are thrown whichever method you call, since the database refused the write. See [Errors](./errors#constraint-errors).
- An error thrown by a callback, other than `abort()`, propagates unchanged, even from an after-callback once the record is saved.
- D1's own operational errors always propagate.

## Destroying

<<< @/snippets/guide/persistence.ts#destroy{ts}

`destroy()` runs the destroy callbacks and the associations' [`dependent:` strategies](./associations#dependent-records), then deletes the row. A record is marked destroyed only once the DELETE succeeds. After that its attributes stay readable, but setting one, or calling `save`, `update`, `destroy` or `reload`, throws `RecordDestroyed`.

If the row was already gone (another request deleted it), `save` and `destroy` still succeed.

## Lifecycle state

| State                                            | `isNewRecord()` | `isPersisted()` | `isDestroyed()` |
| ------------------------------------------------ | --------------- | --------------- | --------------- |
| New (from `build()`, or after a failed `create`) | `true`          | `false`         | `false`         |
| Persisted (loaded, or after a successful save)   | `false`         | `true`          | `false`         |
| Destroyed (after a successful `destroy()`)       | `false`         | `false`         | `true`          |

## Reloading

<<< @/snippets/guide/persistence.ts#reload{ts}

`reload()` loads the whole row again, discarding unsaved changes and cached associations. It throws `RecordNotFound` if the row is gone, or the record was never saved.

## Writing without the lifecycle

To update or delete many rows at once, skipping validations and callbacks, use `updateAll`, `deleteAll`, `insert` and `upsert` on a Relation. See [Batches and bulk writes](./batches).
