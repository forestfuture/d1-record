import { InvalidModel } from "./errors.ts";
import type { Executor } from "./executor.ts";
import { ancestors } from "./ancestors.ts";
import { ModelBase, scopeBodies, type ModelClass, type ScopesOf } from "./model.ts";
import { applyScope, Relation, type RelationArgs, type Scoped } from "./relation.ts";

type RelationClass = new (...args: RelationArgs<ModelBase>) => Relation<ModelBase>;

// Module-level, but not request state (ADR-0003): derived only from a Model's scope statics.
const relationClasses = new WeakMap<object, { Class: RelationClass; scopes: object[] }>();

/** A Model's scopes, by name: its statics made with `this.scope(…)`, the nearest class's first. */
function scopesOf(model: ModelClass): Map<string, object> {
  const scopes = new Map<string, object>();
  for (const each of ancestors(model)) {
    if (each === ModelBase) break;
    for (const name of Object.getOwnPropertyNames(each)) {
      const value: unknown = (each as unknown as Record<string, unknown>)[name];
      if (typeof value === "function" && scopeBodies.has(value) && !scopes.has(name)) {
        scopes.set(name, value);
      }
    }
  }
  return scopes;
}

/** The name `model` (or a class it extends) gives the scope static `scoped`. */
export function scopeName(model: ModelClass, scoped: object): string {
  for (const [name, value] of scopesOf(model)) if (value === scoped) return name;
  throw new InvalidModel(`${model.name} has a scope that isn't one of its statics`);
}

// Names a scope can't take: a Model's own statics, besides the Relation methods it mirrors.
// Read on first use: model.ts imports this module, so ModelBase isn't defined while it loads.
let modelStatics: ReadonlySet<string> | undefined;

/** Rejects a scope named like a Relation method or a Model static, or "then". */
function requireScopeName(model: ModelClass, name: string): void {
  // "then" would make Relations awaitable.
  modelStatics ??= new Set(Object.getOwnPropertyNames(ModelBase));
  if (name === "then" || name in Relation.prototype || modelStatics.has(name)) {
    throw new InvalidModel(
      `${model.name} declares a scope "${name}", which is the name of a Relation method or a Model static; rename the scope`,
    );
  }
}

function relationClassFor(model: ModelClass): RelationClass {
  const scopes = scopesOf(model);
  // The scope statics themselves, so a replaced one (same name, new scope) is noticed too.
  const signature = [...scopes.values()];
  const cached = relationClasses.get(model);
  if (cached !== undefined) {
    const same =
      cached.scopes.length === signature.length &&
      cached.scopes.every((scope, index) => scope === signature[index]);
    if (!same) {
      throw new InvalidModel(
        `${model.name}'s scopes changed after its first use; declare them once, in the class body (static name = this.scope(…))`,
      );
    }
    return cached.Class;
  }
  // The library's own Relations: constructible here, though Relation's constructor is protected.
  const ScopedRelation = class extends Relation<ModelBase> {
    constructor(parts: unknown) {
      super(parts);
    }
  };
  for (const [name, scoped] of scopes) {
    requireScopeName(model, name);
    const body = scopeBodies.get(scoped)!;
    Object.defineProperty(ScopedRelation.prototype, name, {
      value(this: Relation<ModelBase>, ...args: unknown[]) {
        return this[applyScope](name, body, args);
      },
    });
  }
  relationClasses.set(model, { Class: ScopedRelation, scopes: signature });
  return ScopedRelation;
}

/** A fresh Relation over all of `model`'s records, with the Model's scopes as methods. */
export function relationFor<C extends ModelClass>(
  executor: Executor,
  model: C,
): Scoped<InstanceType<C>, ScopesOf<C>> {
  const Class = relationClassFor(model) as unknown as new (
    ...args: RelationArgs<InstanceType<C>>
  ) => Scoped<InstanceType<C>, ScopesOf<C>>;
  return new Class({ executor, model: model as unknown as ModelClass<InstanceType<C>> });
}
