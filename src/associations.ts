import { verifyModel, type ModelBase, type ModelClass, type ScopesOf } from "./model.ts";
import { state } from "./record-state.ts";
import type { Scoped } from "./relation.ts";
import { relationFor } from "./scoped-relation.ts";

/** One declared association: its kind, its target Model, and the keys that link them. */
export interface AssociationDefinition {
  kind: "belongsTo" | "hasMany" | "hasOne";
  /** A thunk, so Models can point at each other before both are defined. */
  target: () => ModelClass;
  /** The attribute holding the link: on the owner for belongsTo, on the target otherwise. */
  foreignKey: string;
  /** The attribute the foreign key points at; defaults to the pointed-at Model's primary key. */
  primaryKey?: string;
}

/** The keys linking two Models. */
export interface AssociationKeys {
  foreignKey: string;
  primaryKey?: string;
}

/** `await post.author()`: the owning record, or null. */
export type BelongsTo<C extends ModelClass> = () => Promise<InstanceType<C> | null>;

/** `await user.profile()`: the one associated record, or null. */
export type HasOne<C extends ModelClass> = () => Promise<InstanceType<C> | null>;

/** `user.posts()`: a Relation of the associated records, with the target's scopes. */
export type HasMany<C extends ModelClass> = () => Scoped<InstanceType<C>, ScopesOf<C>>;

const prepared = new WeakSet<object>();

/**
 * Makes a Model ready for use, once: verifies its declaration and installs its association
 * accessors. Module-level, but not request state (ADR-0003): derived only from the class.
 */
export function prepareModel(model: ModelClass): void {
  verifyModel(model);
  if (prepared.has(model)) return;
  for (const [name, definition] of Object.entries(model.associations)) {
    Object.defineProperty(model.prototype, name, {
      configurable: true,
      value: accessorFor(definition),
    });
  }
  prepared.add(model);
}

function accessorFor(definition: AssociationDefinition): (this: ModelBase) => unknown {
  return async function belongsTo(this: ModelBase) {
    const target = definition.target();
    prepareModel(target);
    const key = this[state].read(definition.foreignKey);
    if (key === null) return null;
    const primaryKey = definition.primaryKey ?? target.primaryKey;
    return relationFor(this[state].executor, target).findBy({ [primaryKey]: key });
  };
}
