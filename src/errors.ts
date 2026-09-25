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

/** No record matched a lookup that requires one (`find`, `findByOrThrow`). */
export class RecordNotFound extends D1RecordError {
  override name = "RecordNotFound";
}

/** Reading an attribute that wasn't loaded, e.g. one left out of `select(...)`. */
export class MissingAttribute extends D1RecordError {
  override name = "MissingAttribute";
}
