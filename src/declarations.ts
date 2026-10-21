// A Model's declared callbacks, validations and error messages, inherited, and sealed on its first use.
import { ancestors } from "./ancestors.ts";
import { InvalidModel } from "./errors.ts";
import type { Callback, ModelBase } from "./model.ts";
import type { ErrorMessages } from "./error-messages.ts";
import type { Validation } from "./validations.ts";

/**
 * Per-Model declarations (validations, callbacks, …), keyed by Model class. A subclass starts
 * from a copy of its parent's list, so declaring on it never changes the parent.
 *
 * Module-level, but not request state (ADR-0003): declarations are made once, when a Model
 * class is defined, and only read afterwards.
 */
const registry = new WeakMap<object, Map<string, readonly unknown[]>>();

/** Models that have been used; their declarations can no longer change. */
const sealed = new WeakSet<object>();

/**
 * Called on a Model's first use. From then on, declaring on it throws: declarations belong in
 * the class's `static {}` block, never in request code, where they'd leak into every request.
 */
export function seal(model: object): void {
  sealed.add(model);
}

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

/** A declaration kept with the class it was made on, whose own come first when it's read (#88). */
export interface ClassDeclaration<T> {
  from: object;
  value: T;
}

/** Every kind of per-Model declaration, and what one entry of it is. */
export type Declarations = {
  validations: Validation;
  errorMessages: ClassDeclaration<ErrorMessages>;
  humanAttributeNames: ClassDeclaration<Readonly<Record<string, string>>>;
} & {
  [K in CallbackKind]: Callback<ModelBase>;
};

/** The declarations of `kind` for `model`: its own, or else its nearest ancestor's. */
export function declared<K extends keyof Declarations>(
  model: object,
  kind: K,
): readonly Declarations[K][] {
  for (const current of ancestors(model)) {
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
  if (sealed.has(model)) {
    const { name } = model as { name: string };
    throw new InvalidModel(
      `${name} has already been used; declare validations, callbacks and messages in its static {} block`,
    );
  }
  const own = registry.get(model) ?? new Map<string, readonly unknown[]>();
  registry.set(model, own);
  own.set(kind, [...declared(model, kind), entry]);
}
