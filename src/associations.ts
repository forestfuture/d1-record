import { InvalidModel } from "./errors.ts";
import { belongsToAccessor, hasOneAccessor } from "./association-writers.ts";
import {
  ModelBase,
  modelOf,
  verifyModel,
  type AttributesOf,
  type ModelClass,
  type ScopesOf,
} from "./model.ts";
import { state } from "./record-state.ts";
import { ofOwner, type AssociationCache, type Scoped } from "./relation.ts";
import { linkOf, resolveAssociation, type ResolvedAssociation } from "./resolved-association.ts";

/**
 * An association's scope, as Rails' `has_many :posts, -> { order(:created_at) }`. It receives
 * the target's Relation, untyped (as the keys are, so Models can point at each other), and is
 * checked when it first runs; annotate it (`(q: Relation<Post>) => …`) for full typing.
 */
// oxlint-disable-next-line typescript/no-explicit-any -- typed like the keys: checked on first use
type AssociationScope = (relation: any) => unknown;

/** What an association declaration takes: the keys that link the Models, and a scope. */
export interface AssociationOptions {
  /** The attribute holding the link: on the owner for belongsTo, on the target otherwise. */
  foreignKey: string;
  /** The attribute the foreign key points at; defaults to the pointed-at Model's primary key. */
  primaryKey?: string;
  /** Narrows or orders the target's records for this association: `(q) => q.order(…)`. */
  scope?: AssociationScope;
  /** What destroying the owner does to this association's records (hasMany and hasOne). */
  dependent?: Dependent;
}

/** Rails' `dependent:` strategies for a hasMany. */
export type HasManyDependent =
  | "destroy"
  | "deleteAll"
  | "nullify"
  | "restrictWithException"
  | "restrictWithError";

/** Rails' `dependent:` strategies for a hasOne: `delete` in place of `deleteAll`. */
export type HasOneDependent =
  | "destroy"
  | "delete"
  | "nullify"
  | "restrictWithException"
  | "restrictWithError";

type Dependent = HasManyDependent | HasOneDependent;

const DEPENDENTS: Record<AssociationDefinition["kind"], readonly Dependent[]> = {
  belongsTo: [],
  hasMany: ["destroy", "deleteAll", "nullify", "restrictWithException", "restrictWithError"],
  hasOne: ["destroy", "delete", "nullify", "restrictWithException", "restrictWithError"],
};

/** One declared association: its kind, its target Model, and its options. */
export interface AssociationDefinition extends AssociationOptions {
  kind: "belongsTo" | "hasMany" | "hasOne";
  /** A thunk, so Models can point at each other before both are defined. */
  target: () => ModelClass;
}

/**
 * `await post.author()`: the owning record, or null. `post.author.set(user)` points the post at
 * another record (Rails' `post.author = user`), and `build`/`create` make a new one for it.
 */
export interface BelongsTo<C extends ModelClass> {
  (): Promise<InstanceType<C> | null>;
  set(record: InstanceType<C> | null): void;
  build(attributes?: Partial<AttributesOf<InstanceType<C>>>): InstanceType<C>;
  create(attributes?: Partial<AttributesOf<InstanceType<C>>>): Promise<InstanceType<C>>;
  createOrThrow(attributes?: Partial<AttributesOf<InstanceType<C>>>): Promise<InstanceType<C>>;
}

/**
 * `await user.profile()`: the one associated record, or null. `user.profile.build(attrs)` and
 * `create(attrs)` make a new one pointing at the user (Rails' `build_profile`).
 */
export interface HasOne<C extends ModelClass> {
  (): Promise<InstanceType<C> | null>;
  build(attributes?: Partial<AttributesOf<InstanceType<C>>>): InstanceType<C>;
  create(attributes?: Partial<AttributesOf<InstanceType<C>>>): Promise<InstanceType<C>>;
  createOrThrow(attributes?: Partial<AttributesOf<InstanceType<C>>>): Promise<InstanceType<C>>;
}

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
    Object.defineProperty(model.prototype, name, accessorProperty(name, definition));
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
  const { dependent, kind } = definition;
  if (dependent !== undefined && !DEPENDENTS[kind].includes(dependent)) {
    const allowed = DEPENDENTS[kind].map((each) => `"${each}"`).join(", ");
    throw new InvalidModel(
      `${label}: a ${kind} can't be dependent: "${dependent}"${allowed ? `; use one of ${allowed}` : ""}`,
    );
  }
}

function requireAttribute(label: string, model: ModelClass, name: string): void {
  if (!model.attributeDefinitions.has(name)) {
    throw new InvalidModel(
      `${label}: ${model.name} has no attribute "${name}" (check foreignKey/primaryKey)`,
    );
  }
}

/** Each record's belongsTo and hasOne accessors, made on first use. Not request state. */
const accessors = new WeakMap<ModelBase, Map<string, unknown>>();

/**
 * The property an association adds to its Model's records. A hasMany is a method returning a
 * Relation; a belongsTo or hasOne is a getter for the record's own accessor, a function
 * (`await post.author()`) that also has `set`/`build`/`create` bound to that record.
 */
function accessorProperty(name: string, definition: AssociationDefinition): PropertyDescriptor {
  if (definition.kind === "hasMany") {
    return {
      configurable: true,
      value: function hasMany(this: ModelBase) {
        return hasManyRelation(this, resolveAssociation(modelOf(this), name));
      },
    };
  }
  const accessorFor = definition.kind === "belongsTo" ? belongsToAccessor : hasOneAccessor;
  return {
    configurable: true,
    get(this: ModelBase) {
      const perRecord = accessors.get(this) ?? new Map<string, unknown>();
      accessors.set(this, perRecord);
      if (!perRecord.has(name)) {
        perRecord.set(name, accessorFor(this, resolveAssociation(modelOf(this), name)));
      }
      return perRecord.get(name);
    },
  };
}

/**
 * A hasMany's Relation for `owner`. An owner without a key has no stored records: the
 * association holds what was built through it, which saving the owner saves too (autosave).
 * Otherwise it reads through the owner's cache, and a record built through it joins the loaded
 * records at once, as in Rails.
 */
function hasManyRelation(owner: ModelBase, association: ResolvedAssociation) {
  const { name, definition } = association;
  const key = association.keyOf(owner);
  const relation = association.records(owner[state].executor, key);
  const { foreignKey } = definition;
  const register = (record: ModelBase) => owner[state].addBuilt(name, record);
  if (key === null) {
    const unsavedOwner = missingKeyReason(owner, association);
    return relation[ofOwner]({ foreignKey, unsavedOwner, cache: builtOf(owner, name), register });
  }
  const cache = cacheOf(owner, name, association.ownerAttribute, key);
  // As Rails' collection delete_all: rows are deleted with destroy or deleteAll, else nullified.
  const deletes = definition.dependent === "destroy" || definition.dependent === "deleteAll";
  const unsaved = () => owner[state].built(name).filter((record) => record[state].isNew);
  return relation[ofOwner]({
    foreignKey: deletes ? undefined : foreignKey,
    cache,
    register,
    unsaved,
  });
}

/** An unsaved owner's hasMany: just the records built through it; nothing to fill or clear. */
function builtOf(owner: ModelBase, name: string): AssociationCache {
  return { get: () => [...owner[state].built(name)], set: () => {}, clear: () => {} };
}

/**
 * A belongsTo or hasOne read: the cached record (or null) while the key it was loaded for is
 * current, otherwise `load` for the key the owner holds now, then cached.
 */
export async function cachedRead(
  owner: ModelBase,
  association: ResolvedAssociation,
  load: (key: unknown) => Promise<ModelBase | null>,
): Promise<ModelBase | null> {
  const { name, ownerAttribute } = association;
  const cached = owner[state].cachedAssociation(name);
  if (cached !== undefined) return cached.value as ModelBase | null;
  const key = association.keyOf(owner);
  // No key: nothing to find, and nothing to query; that null is cached like any result.
  const value = key === null ? null : await load(key);
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
    // The stored records, then those built through the association and not among them, as
    // Rails merges new records into what it loads.
    get: () => {
      const loaded = recordState.cachedAssociation(name)?.value as ModelBase[] | undefined;
      if (loaded === undefined) return undefined;
      const built = recordState.built(name).filter((record) => !loaded.includes(record));
      return [...loaded, ...built];
    },
    set: (records) => recordState.cacheAssociation(name, { attribute, key, value: records }),
    clear: () => recordState.clearAssociation(name),
  };
}

/** Why an owner has no key for its targets to point at. */
function missingKeyReason(owner: ModelBase, { ownerAttribute }: ResolvedAssociation): string {
  const { name } = modelOf(owner);
  return owner[state].isNew
    ? `the ${name} hasn't been saved; save the ${name} first`
    : `the ${name} has no ${ownerAttribute}`;
}
