import type { Callback, ModelBase } from "./model.ts";
import type { Validation } from "./validations.ts";

/**
 * Per-Model declarations (validations, callbacks, …), keyed by Model class. A subclass starts
 * from a copy of its parent's list, so declaring on it never changes the parent.
 *
 * Module-level, but not request state (ADR-0003): declarations are made once, when a Model
 * class is defined, and only read afterwards.
 */
const registry = new WeakMap<object, Map<string, readonly unknown[]>>();

/** Callbacks that run before the D1 write, and may `throw abort(reason)` to refuse it. */
export type BeforeCallbackKind =
  | "beforeValidation"
  | "afterValidation"
  | "beforeSave"
  | "beforeCreate"
  | "beforeUpdate"
  | "beforeDestroy";

/** Callbacks that run after a successful write; `abort()` there is `AbortAfterPersistence`. */
export type AfterCallbackKind = "afterCreate" | "afterUpdate" | "afterSave" | "afterDestroy";

export type CallbackKind = BeforeCallbackKind | AfterCallbackKind;

/** Every kind of per-Model declaration, and what one entry of it is. */
export type Declarations = { validations: Validation } & {
  [K in CallbackKind]: Callback<ModelBase>;
};

/** The declarations of `kind` for `model`: its own, or else its nearest ancestor's. */
export function declared<K extends keyof Declarations>(
  model: object,
  kind: K,
): readonly Declarations[K][] {
  for (
    let current: object | null = model;
    current !== null && current !== Function.prototype;
    current = Object.getPrototypeOf(current) as object | null
  ) {
    const list = registry.get(current)?.get(kind);
    if (list !== undefined) return list as readonly Declarations[K][];
  }
  return [];
}

/** Adds a declaration of `kind` to `model`, copying its inherited list first. */
export function declare<K extends keyof Declarations>(
  model: object,
  kind: K,
  entry: Declarations[K],
): void {
  const own = registry.get(model) ?? new Map<string, readonly unknown[]>();
  registry.set(model, own);
  own.set(kind, [...declared(model, kind), entry]);
}
