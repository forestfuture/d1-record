// A class marked abstract between the base class and some Models: it has no table, and the
// Models below it share its callback (#232).
import { DbRecord } from "./db-record.ts";

/** Each record about to be saved, by its class's name, as Auditable's callback saw it. */
export const audited: string[] = [];

export abstract class Auditable extends DbRecord {
  static override abstract = true;

  static {
    this.beforeSave((record) => void audited.push(record.constructor.name));
  }
}
