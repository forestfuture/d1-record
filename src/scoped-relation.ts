import { InvalidModel } from "./errors.ts";
import type { Executor } from "./executor.ts";
import type { ModelBase, ModelClass, ScopesOf } from "./model.ts";
import { applyScope, Relation, type RelationArgs, type Scope, type Scoped } from "./relation.ts";

type RelationClass = new (...args: RelationArgs<ModelBase>) => Relation<ModelBase>;

// Module-level, but not request state (ADR-0003): derived only from a Model's static scopes.
const relationClasses = new WeakMap<object, { Class: RelationClass; scopes: object }>();

function relationClassFor(model: ModelClass): RelationClass {
  const cached = relationClasses.get(model);
  if (cached !== undefined) {
    if (cached.scopes !== model.scopes) {
      throw new InvalidModel(
        `${model.name}'s scopes changed after its first use; declare them once, in the class body (static scopes = …)`,
      );
    }
    return cached.Class;
  }
  const ScopedRelation = class extends Relation<ModelBase> {};
  for (const [name, scope] of Object.entries(model.scopes)) {
    // A scope must not hide a Relation method, and "then" would make Relations awaitable.
    if (name === "then" || name in Relation.prototype) {
      throw new InvalidModel(
        `${model.name} declares a scope "${name}", which is the name of a Relation method; rename the scope`,
      );
    }
    Object.defineProperty(ScopedRelation.prototype, name, {
      value(this: Relation<ModelBase>, ...args: unknown[]) {
        return this[applyScope](name, scope as Scope<ModelBase>, args);
      },
    });
  }
  relationClasses.set(model, { Class: ScopedRelation, scopes: model.scopes });
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
  return new Class(executor, model as unknown as ModelClass<InstanceType<C>>);
}
