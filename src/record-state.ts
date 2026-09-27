import type { Assignment } from "./compiler.ts";
import { readValue, writeValue } from "./conversion.ts";
import { Errors } from "./errors-collection.ts";
import { MissingAttribute, NoDatabase, RecordDestroyed } from "./errors.ts";
import type { Executor } from "./executor.ts";
import {
  attributeOf,
  evaluateDefaults,
  requireDefined,
  type AttributeDefinition,
} from "./metadata.ts";
import type { ModelClass } from "./model.ts";

/** The hidden slot where a Record keeps its `RecordState`; never exported from the package. */
export const state = Symbol("state");

/** `{ attribute: [before, after] }` */
export type Changes = Record<string, [before: unknown, after: unknown]>;

type Lifecycle = "new" | "persisted" | "destroyed";

/**
 * Everything one Record knows about itself: its attribute values, lifecycle, the attributes
 * assigned since it was built, its Snapshot (each loaded attribute's stored form as last loaded
 * or saved), the changes its last save wrote, and the Database it belongs to.
 *
 * This is the only module that reads or writes those fields. Every rule about them (unloaded
 * attributes, undefined values, destroyed records, change detection) is enforced here.
 */
export class RecordState {
  readonly #model: ModelClass;
  #executor: Executor | undefined;
  #lifecycle: Lifecycle = "new";
  readonly #values: Record<string, unknown> = {};
  readonly #assigned = new Set<string>();
  readonly #snapshot = new Map<string, unknown>();
  #savedChanges: Changes = {};
  readonly #errors = new Errors();
  #abortReason: string | undefined;
  readonly #preloaded = new Map<string, unknown>();

  constructor(model: ModelClass) {
    this.#model = model;
  }

  /** The record's validation errors, filled by the last validation run. */
  get errors(): Errors {
    return this.#errors;
  }

  /** Why a callback last refused a save or destroy; cleared at the start of each run. */
  get abortReason(): string | undefined {
    return this.#abortReason;
  }

  set abortReason(reason: string | undefined) {
    this.#abortReason = reason;
  }

  // Lifecycle and Database

  /** Not yet saved: built, or created but not persisted. */
  get isNew(): boolean {
    return this.#lifecycle === "new";
  }

  /** Backed by a row: loaded, or saved successfully. */
  get isPersisted(): boolean {
    return this.#lifecycle === "persisted";
  }

  /** Deleted by this instance: a read-only snapshot of the row. */
  get isDestroyed(): boolean {
    return this.#lifecycle === "destroyed";
  }

  /** Records belong to the Database they were built or loaded through (ADR-0003). */
  belongTo(executor: Executor): void {
    this.#executor = executor;
  }

  /** The record's Database; `NoDatabase` for a record constructed directly (`new User()`). */
  get executor(): Executor {
    if (this.#executor === undefined) {
      const { name } = this.#model;
      throw new NoDatabase(
        `${name} record has no Database; build or load records through db.model(${name})`,
      );
    }
    return this.#executor;
  }

  /**
   * Refuses to use a record as a live one when it can't be: a destroyed record is a read-only
   * snapshot, and a persisted record without its primary key (from `select(...).distinct()`)
   * has no identity to write by.
   */
  requireLive(action: string): void {
    this.#requireNotDestroyed(action);
    this.requireKey(action);
  }

  /** A persisted record needs its primary key to be found by; one from `distinct()` has none. */
  requireKey(action: string): void {
    const { name, primaryKey } = this.#model;
    if (this.#lifecycle === "persisted" && !this.#snapshot.has(primaryKey)) {
      throw new MissingAttribute(
        `${name} record has no primary key loaded (it came from select(...).distinct()); ` +
          `it can't ${action}`,
      );
    }
  }

  // Attributes

  /** An attribute's value; `MissingAttribute` if it wasn't loaded (left out of `select`). */
  read(name: string): unknown {
    if (!(name in this.#values)) {
      throw new MissingAttribute(
        `${this.#model.name} record has no "${name}" loaded; it was left out of select(...)`,
      );
    }
    return this.#values[name];
  }

  /**
   * Assigns one attribute. `undefined` throws `TypeError`, because it would silently store NULL
   * (use `null` for that); a destroyed record is read-only.
   */
  write(name: string, value: unknown): void {
    this.#requireNotDestroyed("be changed");
    requireDefined(this.#model, name, value);
    this.#values[name] = value;
    this.#assigned.add(name);
  }

  /** Assigns several attributes; unknown names throw `UnknownAttribute`. */
  assign(attributes: Record<string, unknown>): void {
    for (const [name, value] of Object.entries(attributes)) {
      attributeOf(this.#model, name);
      this.write(name, value);
    }
  }

  /** A new record: every attribute reads as null until assigned, and defaults are evaluated now. */
  build(attributes: Record<string, unknown>): void {
    for (const name of this.#model.attributeDefinitions.keys()) this.#values[name] = null;
    for (const [name, value] of evaluateDefaults(this.#model)) this.write(name, value);
    this.assign(attributes);
  }

  /** Associations loaded by `includes`: a record, an array of records, or null. */
  setPreloaded(name: string, value: unknown): void {
    this.#preloaded.set(name, value);
  }

  hasPreloaded(name: string): boolean {
    return this.#preloaded.has(name);
  }

  preloaded(name: string): unknown {
    return this.#preloaded.get(name);
  }

  /** Loads a D1 row; the record becomes persisted and clean, and preloaded associations are dropped. */
  loadRow(row: Record<string, unknown>): void {
    this.#preloaded.clear();
    for (const [name, { type, column }] of this.#model.attributeDefinitions) {
      if (column in row) this.#values[name] = readValue(type, row[column]);
    }
    this.#markSaved();
  }

  /** The loaded attributes as a plain object (the record's own values, not copies). */
  attributes(): Record<string, unknown> {
    return { ...this.#values };
  }

  // Changes

  /** A new record's assigned attributes, or a persisted one's that differ from the Snapshot. */
  changedNames(): string[] {
    if (this.#lifecycle === "new") return [...this.#assigned];
    return Object.keys(this.#values).filter(
      (name) => !this.#snapshot.has(name) || this.#snapshot.get(name) !== this.#storedForm(name),
    );
  }

  /** `{ attribute: [before, after] }`; both are copies, never the record's own objects. */
  changes(): Changes {
    const changes: Changes = {};
    for (const name of this.changedNames()) {
      const before = this.#snapshot.has(name)
        ? readValue(this.#definition(name).type, this.#snapshot.get(name))
        : null;
      changes[name] = [before, this.#copyOf(name)];
    }
    return changes;
  }

  /** The changes the last successful save wrote (copies). */
  savedChanges(): Changes {
    return { ...this.#savedChanges };
  }

  // Writes

  /** The attributes an insert writes: the assigned ones, so column defaults apply to the rest. */
  insertAssignments(): Assignment[] {
    return this.#assignmentsOf([...this.#assigned]);
  }

  /** The attributes an update writes: the changed ones. */
  updateAssignments(): Assignment[] {
    return this.#assignmentsOf(this.changedNames());
  }

  /** The primary key as stored in D1: the row's key before any unsaved change to it. */
  get storedKey(): unknown {
    return this.#snapshot.get(this.#model.primaryKey);
  }

  /** The stored primary key as a JavaScript value, e.g. to find the row again. */
  get storedKeyValue(): unknown {
    return readValue(this.#definition(this.#model.primaryKey).type, this.storedKey);
  }

  /** After an insert: load what D1 stored; `savedChanges` is everything the new row holds. */
  commitInsert(row: Record<string, unknown> | undefined): void {
    if (row === undefined) this.#markSaved();
    else this.loadRow(row);
    this.#savedChanges = Object.fromEntries(
      Object.keys(this.#values)
        .filter((name) => this.#values[name] !== null)
        .map((name) => [name, [null, this.#copyOf(name)]]),
    );
  }

  /** After an update: apply values the write added (timestamps), then record the save. */
  commitUpdate(added: readonly Assignment[]): void {
    for (const [name, value] of added) this.#values[name] = value;
    this.#savedChanges = this.changes();
    this.#markSaved();
  }

  /** A save with nothing to write: nothing changes but `savedChanges`. */
  commitClean(): void {
    this.#savedChanges = {};
  }

  markDestroyed(): void {
    this.#lifecycle = "destroyed";
  }

  // Internals

  /** A destroyed record is a read-only snapshot. (A keyless record may change in memory.) */
  #requireNotDestroyed(action: string): void {
    if (this.#lifecycle === "destroyed") {
      throw new RecordDestroyed(`${this.#model.name} record was destroyed; it can't ${action}`);
    }
  }

  #definition(name: string): AttributeDefinition {
    return attributeOf(this.#model, name);
  }

  /** An attribute's current value in its stored form, for comparing with the Snapshot. */
  #storedForm(name: string): unknown {
    return writeValue(this.#definition(name).type, this.#values[name]);
  }

  /** A copy of an attribute's current value, read back from its stored form. */
  #copyOf(name: string): unknown {
    return readValue(this.#definition(name).type, this.#storedForm(name));
  }

  #assignmentsOf(names: readonly string[]): Assignment[] {
    return names.map((name): Assignment => [name, this.#values[name]]);
  }

  /** The current values become the Snapshot: persisted and clean. */
  #markSaved(): void {
    this.#snapshot.clear();
    for (const name of Object.keys(this.#values)) {
      this.#snapshot.set(name, this.#storedForm(name));
    }
    this.#lifecycle = "persisted";
    this.#assigned.clear();
  }
}
