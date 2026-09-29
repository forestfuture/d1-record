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
- **Nothing is rolled back** once the write has succeeded. A save's writes go to D1 as one atomic batch, and D1 has committed them before any after-callback runs, so there's nothing held open to undo. An error thrown by an after-callback propagates to the caller, but the record stays saved.

## Stopping a save with `abort()`

Throw `abort(reason)` from a before-callback to stop a save or destroy:

- `save()` returns `false` and writes nothing. The record keeps its changes, and `record.abortReason` holds the reason.
- `saveOrThrow()` throws `RecordNotSaved` with the reason.
- `destroy()` returns `false`, and `destroyOrThrow()` throws `RecordNotDestroyed`.

Only `abort()` stops a save. Returning `false` from a callback does nothing, and any other error propagates as it is.

`abort()` works in `beforeValidation`, `afterValidation`, `beforeSave`, `beforeCreate`, `beforeUpdate` and `beforeDestroy`. In an after-callback it's too late: the write has happened, so it becomes an `AbortAfterPersistence` error naming the callback.

## Rails callbacks d1-record doesn't have

**Not needed on D1:**

- **`after_commit`, `after_rollback`** and their `after_*_commit` shortcuts. In Rails, a save runs inside a database transaction, and `after_save` runs before that transaction commits, so `after_commit` exists to wait until it has. Here, D1 has already committed a save's writes before any after-callback runs, so `afterSave`, `afterCreate`, `afterUpdate` and `afterDestroy` are already "after commit". In a [`db.batch`](./batches#records-in-a-batch), after-callbacks run once the whole batch is written. There's no rollback to hook into: when D1 refuses a write, nothing was written, and the save throws the [constraint error](./errors#constraint-errors).

**Not built yet**, since nothing in D1 prevents them:

- `around_save`, `around_create`, `around_update` and `around_destroy` ([#48](https://github.com/forestfuture/d1-record/issues/48)).
- `after_initialize` and `after_find` ([#49](https://github.com/forestfuture/d1-record/issues/49)).
- `touch` and `after_touch` ([#50](https://github.com/forestfuture/d1-record/issues/50)).
- The `on: :create` / `on: :update` option ([#51](https://github.com/forestfuture/d1-record/issues/51)). Until then, use `if: (record) => record.isNewRecord()` on a validation, or check `isNewRecord()` inside a callback.

Rails' `if:` and `unless:` options for callbacks aren't needed: a callback is a function, so write the condition inside it.

## Declared once

Callbacks, like validations, belong in the class's `static {}` block. Once a Model has been used, declaring more throws `InvalidModel`, so request code can never add a callback that leaks into later requests.
