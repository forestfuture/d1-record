import { InvalidModel } from "./errors.ts";
import { associationsOf } from "./association-fields.ts";
import { belongsToAccessor, hasOneAccessor } from "./association-writers.ts";
import { inferenceHint, type Inference } from "./foreign-keys.ts";
import {
  ModelBase,
  modelOf,
  verifyModel,
  type AttributesOf,
  type ModelClass,
  type ScopesOf,
} from "./model.ts";
import { state } from "./record-state.ts";
import { ownedCollection } from "./owned-collection.ts";
import { ofOwner, type Scoped } from "./relation.ts";
import { linkOf, resolveAssociation, type ResolvedAssociation } from "./resolved-association.ts";

/**
 * An association's scope, as Rails' `has_many :posts, -> { order(:created_at) }`: it receives
 * the target's Relation, with its scopes, and returns a narrowed one.
 */
type AssociationScope<C extends ModelClass> = (
  relation: Scoped<InstanceType<C>, ScopesOf<C>>,
) => unknown;

/** What an association declaration takes: the keys that link the Models, and a scope. */
export interface AssociationOptions<C extends ModelClass = ModelClass> {
  /**
   * The attribute holding the link: on the owner for belongsTo, on the target otherwise.
   * Inferred when left out, as Rails does: a belongsTo's name + `Id` (`author` → `authorId`),
   * or for a hasMany/hasOne the owner's class name + `Id` (`User` → `userId`).
   */
  foreignKey?: string;
  /** The attribute the foreign key points at; defaults to the pointed-at Model's primary key. */
  primaryKey?: string;
  /** Narrows or orders the target's records for this association: `(q) => q.order(…)`. */
  scope?: AssociationScope<C>;
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

const DEPENDENTS: Record<AssociationKind, readonly Dependent[]> = {
  belongsTo: [],
  hasMany: ["destroy", "deleteAll", "nullify", "restrictWithException", "restrictWithError"],
  hasOne: ["destroy", "delete", "nullify", "restrictWithException", "restrictWithError"],
};

export type AssociationKind = "belongsTo" | "hasMany" | "hasOne";

/** One declared association: its kind, its target Model, and its options. */
export interface AssociationDeclaration extends AssociationOptions {
  kind: AssociationKind;
  /** A thunk, so Models can point at each other before both are defined. */
  target: () => ModelClass;
}

/** One declared association, its foreign key given or inferred from the names (`associationsOf`). */
export interface AssociationDefinition extends AssociationDeclaration {
  foreignKey: string;
  /** Where an inferred foreign key came from, for error messages. */
  inferredFrom?: Inference;
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

/** Each prepared Model. */
const prepared = new WeakSet<object>();

/**
 * Makes a Model ready for use, once: verifies its declaration, checks its associations and
 * installs their accessors. Module-level, but not request state (ADR-0003): derived only from
 * the class.
 */
export function prepareModel(model: ModelClass): void {
  verifyModel(model);
  if (prepared.has(model)) return;
  for (const [name, definition] of Object.entries(associationsOf(model))) {
    checkAssociation(model, name, definition);
    Object.defineProperty(model.prototype, name, accessorProperty(name, definition));
  }
  prepared.add(model);
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
    throw new InvalidModel(`${label} must point at a Model class: hasMany(Post, …)`);
  }
  const { ownerAttribute, targetAttribute } = linkOf(definition, model, target as ModelClass);
  // The foreign key is the owner's attribute for a belongsTo, the target's otherwise.
  const [ownerHint, targetHint] =
    definition.kind === "belongsTo"
      ? [keyHint(definition), "check primaryKey"]
      : ["check primaryKey", keyHint(definition)];
  requireAttribute(label, model, ownerAttribute, ownerHint);
  requireAttribute(label, target as ModelClass, targetAttribute, targetHint);
  const { dependent, kind } = definition;
  if (dependent !== undefined && !DEPENDENTS[kind].includes(dependent)) {
    const allowed = DEPENDENTS[kind].map((each) => `"${each}"`).join(", ");
    throw new InvalidModel(
      `${label}: a ${kind} can't be dependent: "${dependent}"${allowed ? `; use one of ${allowed}` : ""}`,
    );
  }
}

/** What to check when the foreign key isn't an attribute: where it was inferred from, if it was. */
function keyHint({ inferredFrom }: AssociationDefinition): string {
  return inferredFrom === undefined ? "check foreignKey" : inferenceHint(inferredFrom);
}

function requireAttribute(label: string, model: ModelClass, name: string, hint: string): void {
  if (model.attributeDefinitions.has(name)) return;
  throw new InvalidModel(`${label}: ${model.name} has no attribute "${name}" (${hint})`);
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
 * A hasMany's Relation for `owner`: its target's records linked to the owner, answering from
 * what the owner holds (its owned collection) where it can.
 */
function hasManyRelation(owner: ModelBase, association: ResolvedAssociation) {
  const relation = association.linkedTo(owner[state].executor, association.keyOf(owner));
  return relation[ofOwner](ownedCollection(owner, association));
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
