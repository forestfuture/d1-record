/** Base class for every error the library throws on purpose. */
export class D1RecordError extends Error {
  override name = "D1RecordError";
}

/** A Model's declaration is invalid, e.g. it has no `tableName`. */
export class InvalidModel extends D1RecordError {
  override name = "InvalidModel";
}

/** A key that isn't a declared attribute of the Model. */
export class UnknownAttribute extends D1RecordError {
  override name = "UnknownAttribute";
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

/** Combining relations that can't be combined (`or`, `merge`), e.g. of different Models. */
export class IncompatibleRelation extends D1RecordError {
  override name = "IncompatibleRelation";
}

/** Using a destroyed record as a live one: `save`, `update`, `destroy` or `reload` after `destroy()`. */
export class RecordDestroyed extends D1RecordError {
  override name = "RecordDestroyed";
}

/**
 * D1 rejected a write because of a database constraint. `table`, `columns` and `attributes`
 * are filled in when D1's message names them. The original D1 error is the `cause`.
 */
export class ConstraintViolation extends D1RecordError {
  override name = "ConstraintViolation";
  readonly table: string;
  readonly columns: readonly string[];
  readonly attributes: readonly string[];

  constructor(
    message: string,
    details: {
      table: string;
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
