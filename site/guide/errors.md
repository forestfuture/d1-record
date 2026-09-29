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
| `IncompatibleRelation` | combining Relations that can't be combined, or preloading a limited scope       |
| `IrreversibleOrder`    | `last()` on a Relation ordered by an `sql` fragment                             |
| `DeleteRestriction`    | destroying an owner whose `restrictWithException` association still has records |
| `NoDatabase`           | using a record made with `new` rather than `build`                              |
| `NoSession`            | `db.bookmark()` on a Database opened without a session                          |

## Constraint errors

When D1 refuses a write because of a constraint, the error is translated into a subclass of `ConstraintViolation`:

| Error               | Constraint              |
| ------------------- | ----------------------- |
| `RecordNotUnique`   | `UNIQUE`, `PRIMARY KEY` |
| `InvalidForeignKey` | `FOREIGN KEY`           |
| `NotNullViolation`  | `NOT NULL`              |
| `CheckViolation`    | `CHECK`                 |

Each carries D1's original error as `cause`, the `table`, and the `columns` and `attributes` involved where D1's message names them:

```ts
try {
  await user.save();
} catch (error) {
  if (error instanceof RecordNotUnique && error.attributes.includes("email")) {
    user.errors.add("email", "has already been taken", { type: "taken" });
  } else {
    throw error;
  }
}
```

Constraint errors are thrown by every method, `save()` as well as `saveOrThrow()`, since the database refused the write. Your changes to the record are kept, so you can fix them and try again.
