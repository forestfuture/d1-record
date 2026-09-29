import type { ModelBase } from "./model.ts";

/** @internal The library's key for what `db.batch` needs from a RecordStatement. */
export const recordStatementParts = Symbol("recordStatementParts");

/**
 * A record's save or destroy for `db.batch([...])`: `user.saveStatement()`,
 * `post.destroyStatement()`. Unlike a Statement, nothing is compiled yet: the record's
 * validations and callbacks run when the batch runs. It has no `then`, so it's never run by
 * being awaited.
 */
export class RecordStatement<R extends ModelBase = ModelBase> {
  readonly #record: R;
  readonly #kind: "save" | "destroy";

  /** @internal Use `record.saveStatement()` or `record.destroyStatement()`. */
  constructor(record: R, kind: "save" | "destroy") {
    this.#record = record;
    this.#kind = kind;
  }

  /** @internal What `db.batch` needs: the record, and whether it's saved or destroyed. */
  get [recordStatementParts](): { record: R; kind: "save" | "destroy" } {
    return { record: this.#record, kind: this.#kind };
  }
}
