import type { Executor } from "./executor.ts";

/** Where a record keeps its attribute values; never exported from the package. */
export const values = Symbol("values");
export const state = Symbol("state");

type Lifecycle = "new" | "persisted" | "destroyed";

export interface RecordState {
  lifecycle: Lifecycle;
  /** The Database's executor this record was built or loaded through (ADR-0003). */
  executor?: Executor;
  /** Attributes assigned on a new record; only these are written on insert. */
  assigned: Set<string>;
}
