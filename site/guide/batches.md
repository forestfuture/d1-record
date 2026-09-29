# Batches and bulk writes

## Statements

A **statement** is a write built from a Relation: `insert`, `insertAll`, `upsert`, `updateAll` or `deleteAll`. Statements skip validations and callbacks, as Rails' `update_all` and `insert_all` do, and write in a single SQL statement. Nothing is sent until you `run()` one, or put it in a batch.

<<< @/snippets/guide/batches.ts#statements{ts}

`run()` resolves to D1's `meta`: `changes`, `last_row_id`, `duration` and the rest.

- **`updateAll(changes)`** takes attributes or an `sql` fragment, and leaves `updatedAt` alone, as in Rails. With a `limit` or `offset`, the Relation's order picks which rows are written.
- **`deleteAll()`** deletes the Relation's rows.
- **`insert(attrs)`** writes one row. Declared defaults fill what isn't given (unlike Rails' `insert_all`, since on D1 defaults are where keys are generated), and so do timestamps and a Relation's equality conditions.

### Many rows at once

<<< @/snippets/guide/batches.ts#insert-all{ts}

- **`insertAll(rows)`** inserts every row in one statement. The rows are bound as one JSON value, so there's no limit on how many, beyond D1's 2 MB per value. Every row must have the same attributes. A duplicate throws and writes nothing.
- **`{ onDuplicate: "skip" }`** skips rows that clash with a unique index. In Rails, skipping is the default; here you opt in, so a duplicate is never silently lost.
- **`upsert(attrs)` and `upsertAll(rows)`** update a row that clashes with the primary key, or with another unique index named by `uniqueBy`. Only the attributes you give are updated, and `updatedAt` is set.

## Atomic batches

D1 can't keep a transaction open across `await`s, so there's no `transaction(async (tx) => …)` block. Instead, `db.batch([...])` sends a prepared list of writes that are all written, or none of them:

<<< @/snippets/guide/batches.ts#batch{ts}

It resolves to each entry's result, in order. Rows in one batch can point at each other only through keys that exist before it's sent, so generate keys in code (`crypto.randomUUID()`), not in D1.

## Records in a batch

`record.toSave()` and `record.toDestroy()` bring a record into a batch with its validations and callbacks:

<<< @/snippets/guide/batches.ts#records{ts}

When the batch runs:

1. Each record, in order, is validated and runs its before-callbacks, just as `save()` or `destroy()` would. The first that's invalid or aborts throws (`RecordInvalid`, `RecordNotSaved` or `RecordNotDestroyed`) and nothing is sent.
2. Every write goes out as one atomic batch. If D1 refuses it, with a constraint error, nothing is written and every record keeps its unsaved state.
3. Each record takes its saved state, then its after-callbacks run.

So every before-callback runs before any write, which is different from a Rails transaction, where one record's `after_save` runs before the next record's `before_save`. A record's autosaved associations and `dependent:` strategies join the same batch. A record listed twice, or already saved by its owner's autosave, is written once.
