/**
 * Per-Model declarations (validations, callbacks, …), keyed by Model class. A subclass starts
 * from a copy of its parent's list, so declaring on it never changes the parent.
 *
 * Module-level, but not request state (ADR-0003): declarations are made once, when a Model
 * class is defined, and only read afterwards.
 */
const registry = new WeakMap<object, Map<string, readonly unknown[]>>();

/** The declarations of `kind` for `model`: its own, or else its nearest ancestor's. */
export function declared<T>(model: object, kind: string): readonly T[] {
  for (
    let current: object | null = model;
    current !== null && current !== Function.prototype;
    current = Object.getPrototypeOf(current) as object | null
  ) {
    const list = registry.get(current)?.get(kind);
    if (list !== undefined) return list as readonly T[];
  }
  return [];
}

/** Adds a declaration of `kind` to `model`, copying its inherited list first. */
export function declare(model: object, kind: string, entry: unknown): void {
  const own = registry.get(model) ?? new Map<string, readonly unknown[]>();
  registry.set(model, own);
  own.set(kind, [...declared(model, kind), entry]);
}
