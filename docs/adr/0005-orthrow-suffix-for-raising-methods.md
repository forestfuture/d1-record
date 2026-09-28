# Throwing variants use the `OrThrow` suffix

Rails uses `!` for methods that raise (`save!`, `create!`), and JavaScript identifiers can't contain `!`. The original brief suggested a `Now` suffix. We use `OrThrow` instead (`saveOrThrow`, `createOrThrow`, `updateOrThrow`, `destroyOrThrow`, `findByOrThrow`), because it says what the method does and "Now" suggests timing rather than failure. The pair's return values follow Rails. The non-throwing method signals expected refusal (validation failure or a callback `abort()`) with `false`, or with an unsaved record in the case of `create`. Database-constraint errors and misuse are always thrown, by both methods.

**Batches (#16):** `db.batch([...])` has no single record to return `false` for, so a record statement that's invalid or aborts makes the batch throw (`RecordInvalid`, `RecordNotSaved`, `RecordNotDestroyed`), as `save!` inside a Rails transaction does. `false` stays reserved for the single-record, non-`OrThrow` methods.
