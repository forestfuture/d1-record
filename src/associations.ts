import { InvalidModel } from "./errors.ts";
import { ModelBase, verifyModel, type ModelClass, type ScopesOf } from "./model.ts";
import { state } from "./record-state.ts";
import { ofOwner, type AssociationCache, type Scoped } from "./relation.ts";
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

/**
 * How an association links records: the owner's `ownerAttribute` equals the target's
 * `targetAttribute`. For belongsTo that's owner.foreignKey = target.primaryKey; for
 * hasMany/hasOne it's owner.primaryKey = target.foreignKey. The one place this is decided.
 */
export function linkOf(
  definition: AssociationDefinition,
  owner: ModelClass,
  target: ModelClass,
): { ownerAttribute: string; targetAttribute: string } {
  return definition.kind === "belongsTo"
    ? {
        ownerAttribute: definition.foreignKey,
        targetAttribute: definition.primaryKey ?? target.primaryKey,
      }
    : {
        ownerAttribute: definition.primaryKey ?? owner.primaryKey,
        targetAttribute: definition.foreignKey,
      };
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

/** Each prepared Model, with the associations it was prepared with. */
const prepared = new WeakMap<object, object>();

/**
 * Makes a Model ready for use, once: verifies its declaration, checks its associations and
 * installs their accessors. Module-level, but not request state (ADR-0003): derived only from
 * the class.
 */
export function prepareModel(model: ModelClass): void {
  verifyModel(model);
  const seen = prepared.get(model);
  if (seen !== undefined) {
    if (seen !== model.associations) {
      throw new InvalidModel(
        `${model.name}'s associations changed after its first use; declare them once, in the class body (static associations = …)`,
      );
    }
    return;
  }
  for (const [name, definition] of Object.entries(model.associations)) {
    checkAssociation(model, name, definition);
    Object.defineProperty(model.prototype, name, {
      configurable: true,
      value: accessorFor(name, definition),
    });
  }
  prepared.set(model, model.associations);
}

/** An association's name must be free, its target a Model, and its keys declared attributes. */
function checkAssociation(
  model: ModelClass,
  name: string,
  definition: AssociationDefinition,
): void {
  const label = `${model.name} association "${name}"`;
  if (model.attributeDefinitions.has(name)) {
    throw new InvalidModel(`${label} has the same name as an attribute; rename one of them`);
  }
  if (name in ModelBase.prototype) {
    throw new InvalidModel(`${label} is the name of a record method or property; rename it`);
  }
  const target: unknown = definition.target();
  if (typeof target !== "function" || !(target.prototype instanceof ModelBase)) {
    throw new InvalidModel(`${label} must point at a Model: this.hasMany(() => Post, …)`);
  }
  const { ownerAttribute, targetAttribute } = linkOf(definition, model, target as ModelClass);
  requireAttribute(label, model, ownerAttribute);
  requireAttribute(label, target as ModelClass, targetAttribute);
}

function requireAttribute(label: string, model: ModelClass, name: string): void {
  if (!model.attributeDefinitions.has(name)) {
    throw new InvalidModel(
      `${label}: ${model.name} has no attribute "${name}" (check foreignKey/primaryKey)`,
    );
  }
}

function accessorFor(
  name: string,
  definition: AssociationDefinition,
): (this: ModelBase) => unknown {
  switch (definition.kind) {
    case "belongsTo":
      return async function belongsTo(this: ModelBase) {
        return cachedRead(this, name, definition, (key, target, targetAttribute) =>
          relationFor(this[state].executor, target).findBy({ [targetAttribute]: key }),
        );
      };
    case "hasOne":
      return async function hasOne(this: ModelBase) {
        // Target primary-key order, as preloading uses, so both pick the same record.
        return cachedRead(this, name, definition, (key, target, targetAttribute) =>
          relationFor(this[state].executor, target)
            .where({ [targetAttribute]: key })
            .order({ [target.primaryKey]: "asc" })
            .first(),
        );
      };
    case "hasMany":
      return function hasMany(this: ModelBase) {
        const key = ownerKey(this, definition);
        const target = targetOf(definition);
        const relation = relationFor(this[state].executor, target).where({
          [definition.foreignKey]: key,
        });
        const { foreignKey } = definition;
        // An owner without a key has no records yet; building through it still gets the (null) key.
        if (key === null) {
          return relation[ofOwner]({
            foreignKey,
            unsavedOwner: missingKeyReason(this, definition),
          });
        }
        const { ownerAttribute } = linkOf(definition, model(this), target);
        return relation[ofOwner]({ foreignKey, cache: cacheOf(this, name, ownerAttribute, key) });
      };
  }
}

/**
 * A belongsTo or hasOne read: the cached record (or null) while the key it was loaded for is
 * current, otherwise `load` for the key the owner holds now, then cached.
 */
async function cachedRead(
  owner: ModelBase,
  name: string,
  definition: AssociationDefinition,
  load: (key: unknown, target: ModelClass, targetAttribute: string) => Promise<ModelBase | null>,
): Promise<ModelBase | null> {
  const cached = owner[state].cachedAssociation(name);
  if (cached !== undefined) return cached.value as ModelBase | null;
  const target = targetOf(definition);
  const { ownerAttribute, targetAttribute } = linkOf(definition, model(owner), target);
  const key =
    definition.kind === "belongsTo"
      ? owner[state].read(ownerAttribute)
      : ownerKey(owner, definition);
  if (key === null) return null;
  const value = await load(key, target, targetAttribute);
  owner[state].cacheAssociation(name, { attribute: ownerAttribute, key, value });
  return value;
}

/** The owner's cache for one hasMany, for its Relation to read, fill and clear. */
function cacheOf(
  owner: ModelBase,
  name: string,
  attribute: string,
  key: unknown,
): AssociationCache {
  const recordState = owner[state];
  return {
    get: () => recordState.cachedAssociation(name)?.value as readonly ModelBase[] | undefined,
    set: (records) => recordState.cacheAssociation(name, { attribute, key, value: records }),
    clear: () => recordState.clearAssociation(name),
  };
}

/** The target Model, ready for use. */
function targetOf(definition: AssociationDefinition): ModelClass {
  const target = definition.target();
  prepareModel(target);
  return target;
}

function model(record: ModelBase): ModelClass {
  return record.constructor as ModelClass;
}

/** Why an owner has no key for its targets to point at. */
function missingKeyReason(owner: ModelBase, definition: AssociationDefinition): string {
  const { name } = model(owner);
  const { ownerAttribute } = linkOf(definition, model(owner), definition.target());
  return owner[state].isNew
    ? `the ${name} hasn't been saved; save the ${name} first`
    : `the ${name} has no ${ownerAttribute}`;
}

/** The owner's value that targets point at (its primary key, by default); null if unsaved. */
function ownerKey(owner: ModelBase, definition: AssociationDefinition): unknown {
  if (owner[state].isNew) return null;
  const { ownerAttribute } = linkOf(definition, model(owner), definition.target());
  return owner[state].read(ownerAttribute);
}
