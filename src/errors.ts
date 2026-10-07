// Every error class the library throws on purpose, all extending `D1RecordError`.
import type { ModelBase } from "./model.ts";

/** Base class for every error the library throws on purpose. */
export class D1RecordError extends Error {
  override name = "D1RecordError";
}

/** A Model's declaration is invalid, e.g. an association's foreign key isn't an attribute. */
export class InvalidModel extends D1RecordError {
  override name = "InvalidModel";
}

/** A key that isn't a declared attribute of the Model. */
export class UnknownAttribute extends D1RecordError {
  override name = "UnknownAttribute";
}

/** `bookmark()` was called on a Database opened without a `session`. */
export class NoSession extends D1RecordError {
  override name = "NoSession";
}

/** A record constructed directly (`new User()`) was used for something that needs D1. */
export class NoDatabase extends D1RecordError {
  override name = "NoDatabase";
}

/** No record matched a lookup that requires one (`find`, `findByOrThrow`). */
export class RecordNotFound extends D1RecordError {
  override name = "RecordNotFound";
}

/** Reading an attribute that wasn't loaded, e.g. one left out of `select(...)`. */
export class MissingAttribute extends D1RecordError {
  override name = "MissingAttribute";
}

/** Destroying a record whose `dependent: "restrictWithException"` association still has records. */
export class DeleteRestriction extends D1RecordError {
  override name = "DeleteRestriction";
}

/** `last()` can't reverse an order given as an `sql` fragment (Rails' IrreversibleOrderError). */
export class IrreversibleOrder extends D1RecordError {
  override name = "IrreversibleOrder";
}

/**
 * Things that can't be combined: relations in `or`/`merge` (e.g. of different Models),
 * `includes` or a write statement with `distinct()`, or statements of two Databases in a batch.
 */
export class IncompatibleRelation extends D1RecordError {
  override name = "IncompatibleRelation";
}

/** Using a destroyed record as a live one: `save`, `update`, `destroy` or `reload` after `destroy()`. */
export class RecordDestroyed extends D1RecordError {
  override name = "RecordDestroyed";
}

/**
 * D1 rejected a write because of a database constraint. `table`, `columns` and `attributes`
 * are filled in when D1's message names them. `table` is null only for a batch writing to
 * several tables, when D1 doesn't say which one failed. The original D1 error is the `cause`.
 */
export class ConstraintViolation extends D1RecordError {
  override name = "ConstraintViolation";
  readonly table: string | null;
  readonly columns: readonly string[];
  readonly attributes: readonly string[];

  constructor(
    message: string,
    details: {
      table: string | null;
      columns: readonly string[];
      attributes: readonly string[];
      cause: unknown;
    },
  ) {
    super(message, { cause: details.cause });
    this.table = details.table;
    this.columns = details.columns;
    this.attributes = details.attributes;
  }
}

/** A UNIQUE constraint failed, e.g. another request won the race after validation passed. */
export class RecordNotUnique extends ConstraintViolation {
  override name = "RecordNotUnique";
}

/** A FOREIGN KEY constraint failed. SQLite's message doesn't name the column. */
export class InvalidForeignKey extends ConstraintViolation {
  override name = "InvalidForeignKey";
}

/** A NOT NULL constraint failed. */
export class NotNullViolation extends ConstraintViolation {
  override name = "NotNullViolation";
}

/** A CHECK constraint failed. */
export class CheckViolation extends ConstraintViolation {
  override name = "CheckViolation";
}

/** A `…OrThrow` save was refused because the record is invalid; `record.errors` says why. */
export class RecordInvalid extends D1RecordError {
  override name = "RecordInvalid";
  readonly record: ModelBase;

  constructor(record: ModelBase) {
    super(`Validation failed: ${record.errors.fullMessages().join(", ")}`);
    this.record = record;
  }
}

/**
 * Thrown by a callback to refuse a save or destroy: `throw abort("Account is suspended")`.
 * Only this exact class halts a lifecycle; returning `false` never does.
 */
export class CallbackAbort extends D1RecordError {
  override name = "CallbackAbort";
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

/** Makes the sentinel a pre-write callback throws to refuse: `throw abort("reason")`. */
export function abort(reason = "Aborted by a callback"): CallbackAbort {
  return new CallbackAbort(reason);
}

/** A `…OrThrow` save was refused by a callback's `abort(reason)`. */
export class RecordNotSaved extends D1RecordError {
  override name = "RecordNotSaved";
}

/**
 * `abort()` was thrown from an after-write callback (`afterSave`, `afterCreate`, `afterUpdate`,
 * `afterDestroy`). That's a mistake: the save or destroy already succeeded and nothing rolls back.
 */
export class AbortAfterPersistence extends D1RecordError {
  override name = "AbortAfterPersistence";
  readonly callback: string;
  readonly reason: string;

  constructor(callback: string, lifecycle: "save" | "destroy", abortion: CallbackAbort) {
    super(`abort() in ${callback}: the ${lifecycle} has already succeeded`, { cause: abortion });
    this.callback = callback;
    this.reason = abortion.reason;
  }
}

/** A `destroyOrThrow()` was refused by a `beforeDestroy` callback's `abort(reason)`. */
export class RecordNotDestroyed extends D1RecordError {
  override name = "RecordNotDestroyed";
}

/** A name passed to `includes()` or `loaded()` that isn't one of the Model's associations. */
export class UnknownAssociation extends D1RecordError {
  override name = "UnknownAssociation";
}

/** `record.loaded(name)` for an association that wasn't preloaded or read yet. */
export class AssociationNotLoaded extends D1RecordError {
  override name = "AssociationNotLoaded";
}
