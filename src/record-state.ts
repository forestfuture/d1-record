import type { Executor } from "./executor.ts";

/** Where a record keeps its attribute values and lifecycle state; neither is exported from the package. */
export const values = Symbol("values");
export const state = Symbol("state");

/** `{ attribute: [before, after] }` */
export type Changes = Record<string, [before: unknown, after: unknown]>;

type Lifecycle = "new" | "persisted" | "destroyed";

export interface RecordState {
  lifecycle: Lifecycle;
  /** The Database's executor this record was built or loaded through (ADR-0003). */
  executor?: Executor;
  /** Attributes assigned on a new record; only these are written on insert. */
  assigned: Set<string>;
  /** Each loaded attribute's stored form as last loaded or saved; changes are measured against it. */
  snapshot: Map<string, unknown>;
  /** The changes the last successful save wrote, as `{ attribute: [before, after] }`. */
  savedChanges: Changes;
}
