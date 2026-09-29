# Callbacks

Callbacks run your code at points in a record's lifecycle. They're declared in a Model's `static {}` block, receive the record (typed as the Model's record), and may be async.

<<< @/snippets/guide/callbacks.ts#callbacks{ts}

## The order

Saving runs:

```text
beforeValidation → validators → afterValidation
→ beforeSave → beforeCreate | beforeUpdate
→ the D1 write (skipped when a persisted record has no changes)
→ the record becomes persisted and clean
→ afterCreate | afterUpdate → afterSave
```

Destroying runs `beforeDestroy`, the associations' `dependent:` strategies, the DELETE, then `afterDestroy`.

Callbacks of one kind run in the order declared. A subclass runs its parent's callbacks, then its own.

- **After-callbacks** run after a successful save, which isn't always a write: saving a record with no changes runs every callback but sends nothing, as in Rails.
- A **before-callback that changes an attribute** makes the record dirty, and the change is written.
- An **after-callback that changes an attribute** leaves the record dirty. Nothing is written again automatically.
- **Nothing is rolled back** once the write has succeeded. D1 has no transaction to undo, so an error thrown by an after-callback propagates, but the record stays saved.

## Stopping a save with `abort()`

Throw `abort(reason)` from a before-callback to stop a save or destroy:

- `save()` returns `false` and writes nothing. The record keeps its changes, and `record.abortReason` holds the reason.
- `saveOrThrow()` throws `RecordNotSaved` with the reason.
- `destroy()` returns `false`, and `destroyOrThrow()` throws `RecordNotDestroyed`.

Only `abort()` stops a save. Returning `false` from a callback does nothing, and any other error propagates as it is.

`abort()` works in `beforeValidation`, `afterValidation`, `beforeSave`, `beforeCreate`, `beforeUpdate` and `beforeDestroy`. In an after-callback it's too late: the write has happened, so it becomes an `AbortAfterPersistence` error naming the callback.

## Declared once

Callbacks, like validations, belong in the class's `static {}` block. Once a Model has been used, declaring more throws `InvalidModel`, so request code can never add a callback that leaks into later requests.
