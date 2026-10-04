---
description: "Every error d1-record throws: lifecycle, usage and constraint errors, and when each is raised."
---

# Errors

Every error d1-record throws extends `D1RecordError`, so one `instanceof` check separates them from anything else.

## Lifecycle errors

| Error                   | When                                                                     |
| ----------------------- | ------------------------------------------------------------------------ |
| `RecordNotFound`        | `find`, `findByOrThrow` or `reload` found nothing                        |
| `RecordInvalid`         | an `OrThrow` save found the record invalid; the record is on `.record`   |
| `RecordNotSaved`        | a save was aborted by a callback, or needs an owner that isn't saved     |
| `RecordNotDestroyed`    | a destroy was aborted, or restricted by `restrictWithError`              |
| `RecordDestroyed`       | writing to a record that's already destroyed                             |
| `CallbackAbort`         | what `abort()` makes; caught by the lifecycle                            |
| `AbortAfterPersistence` | `abort()` in an after-callback, too late to stop the write (`.callback`) |

## Usage errors

These mean the code needs to change, rather than that something happened at runtime:

| Error                  | When                                                                            |
| ---------------------- | ------------------------------------------------------------------------------- |
| `InvalidModel`         | a Model's declaration is wrong, detected the first time it's used               |
| `UnknownAttribute`     | an attribute that isn't declared, in `build`, `where`, `update`, …              |
| `MissingAttribute`     | reading an attribute that `select` didn't load                                  |
| `UnknownAssociation`   | an association that isn't declared                                              |
| `AssociationNotLoaded` | `loaded()` on an association that wasn't loaded                                 |
| `IncompatibleRelation` | two Relations or writes can't be used together (below)                          |
| `IrreversibleOrder`    | `last()` on a Relation ordered by an `sql` fragment                             |
| `DeleteRestriction`    | destroying an owner whose `restrictWithException` association still has records |
| `NoDatabase`           | using a record made with `new` rather than `build`                              |
| `NoSession`            | `db.bookmark()` on a Database opened without a session                          |

### When Relations are incompatible

`IncompatibleRelation` means you've combined things that can't produce a correct query or write:

- **`or()` or `merge()`** with a Relation of another Model, or from another Database. `or()` also needs both sides to have the same `select`, order, `limit`, `offset`, `distinct` and `includes`, since only their conditions can be combined.
- **`batch([...])` or `db.batch([...])`** with statements or records from two databases. A batch runs on one connection.
- **`includes`** with `select(...).distinct()`. Preloading needs the keys, and adding them would undo the `distinct`.
- **Preloading an association scope** that uses `limit`, `offset` or `distinct`. One preload query serves every owner, so the limit would apply to all of their records together.
- **`updateAll` or `deleteAll`** after `distinct()`: they reject with it, and `toUpdateAll`/`toDeleteAll` throw it.

## Constraint errors

When D1 refuses a write because of a constraint, the error is translated into a subclass of `ConstraintViolation`:

| Error               | Constraint              |
| ------------------- | ----------------------- |
| `RecordNotUnique`   | `UNIQUE`, `PRIMARY KEY` |
| `InvalidForeignKey` | `FOREIGN KEY`           |
| `NotNullViolation`  | `NOT NULL`              |
| `CheckViolation`    | `CHECK`                 |

Each carries D1's original error as `cause`, the `table`, and the `columns` and `attributes` involved where D1's message names them:

<<< @/snippets/guide/errors.ts#not-unique{ts}

Constraint errors are thrown by every method, `save()` as well as `saveOrThrow()`, since the database refused the write. Your changes to the record are kept, so you can fix them and try again.
