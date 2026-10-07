// A hasMany's Relation as its owner sees it (records built through it join the owner), or no owner.
import type { ModelBase } from "./model.ts";
import { state } from "./record-state.ts";
import type { ResolvedAssociation } from "./resolved-association.ts";

/**
 * A hasMany as its owner holds it: the owner-side rules its Relation follows. The Relation
 * describes the query; this answers what the owner already knows. There are two adapters:
 * an owner with a key (its loaded records, cached on it, followed by the ones built through
 * it) and an owner without one (just what was built through it). A narrowed Relation of it
 * (`where`, `order`, a scope, …) keeps a narrowed form: records built or created through it
 * still join the owner, but reads query. A plain query's Relation holds `unowned`, which
 * knows nothing and joins nothing, so a Relation never asks whether it has an owner.
 */
export interface OwnedCollection {
  /** The records it holds without a query (stored, then built), or undefined if not loaded. */
  loaded(): readonly ModelBase[] | undefined;
  /** Keeps records just loaded from D1. Only the association itself has it, not narrowed ones. */
  fill?(records: readonly ModelBase[]): void;
  /** A record created through it joins the loaded records, as in Rails. */
  created(record: ModelBase): void;
  /** A record built through it, for autosave. */
  built(record: ModelBase): void;
  /** A statement was built through it, so what's loaded is no longer known. */
  invalidate(): void;
  /** How many records were built through it and not yet saved, which `size()` counts. */
  unsavedCount(): number;
  /** Why records can't be created through it, if they can't: its owner has no key. */
  readonly refusal: string | undefined;
  /**
   * The foreign key `deleteAll()` sets to NULL rather than deleting, as Rails' has_many does
   * without a deleting `dependent:`; undefined when it deletes.
   */
  readonly nullifies: string | undefined;
  /** Its foreign key and association, which a key that can't be cast names (#94); none unowned. */
  readonly link: { attribute: string; association: string } | undefined;
  /** Its form in a narrowed Relation. */
  narrowed(): OwnedCollection;
}

/** A plain query's: no owner, so it holds nothing, refuses nothing, and a deleteAll deletes. */
export const unowned: OwnedCollection = {
  loaded: () => undefined,
  created: () => {},
  built: () => {},
  invalidate: () => {},
  unsavedCount: () => 0,
  refusal: undefined,
  nullifies: undefined,
  link: undefined,
  narrowed: () => unowned,
};

/** `owner`'s hasMany `association`, as its Relation sees it. */
export function ownedCollection(
  owner: ModelBase,
  association: ResolvedAssociation,
): OwnedCollection {
  const key = association.keyOf(owner);
  return key === null ? withoutKey(owner, association) : withKey(owner, association, key);
}

/** An owner with a key: its loaded records live in its association cache. */
function withKey(
  owner: ModelBase,
  association: ResolvedAssociation,
  key: unknown,
): OwnedCollection {
  const recordState = owner[state];
  const { name, ownerAttribute, definition } = association;
  const built = () => recordState.built(name);
  const fill = (records: readonly ModelBase[]) =>
    recordState.cacheAssociation(name, { attribute: ownerAttribute, key, value: records });
  const collection: OwnedCollection = {
    // The stored records, then those built through it and not among them, as Rails merges
    // new records into what it loads.
    loaded() {
      const stored = recordState.cachedAssociation(name)?.value as ModelBase[] | undefined;
      if (stored === undefined) return undefined;
      return [...stored, ...built().filter((record) => !stored.includes(record))];
    },
    fill,
    created(record) {
      const loaded = collection.loaded();
      if (loaded !== undefined) fill([...loaded, record]);
    },
    built: (record) => recordState.addBuilt(name, record),
    invalidate: () => recordState.clearAssociation(name),
    unsavedCount: () => built().filter((record) => record[state].isNew).length,
    refusal: undefined,
    nullifies: association.deletesOnDeleteAll ? undefined : definition.foreignKey,
    link: { attribute: definition.foreignKey, association: name },
    narrowed: () => narrowedOf(collection),
  };
  return collection;
}

/** An owner without a key: no stored records, just what was built through it. */
function withoutKey(owner: ModelBase, association: ResolvedAssociation): OwnedCollection {
  const { name, definition } = association;
  const collection: OwnedCollection = {
    loaded: () => [...owner[state].built(name)],
    created: () => {},
    built: (record) => owner[state].addBuilt(name, record),
    invalidate: () => {},
    unsavedCount: () => 0,
    refusal: association.refusalFor(owner),
    nullifies: definition.foreignKey,
    link: { attribute: definition.foreignKey, association: name },
    narrowed: () => narrowedOf(collection),
  };
  return collection;
}

/** A narrowed Relation's form: building and creating still reach the owner; reads query. */
function narrowedOf(collection: OwnedCollection): OwnedCollection {
  const narrowed: OwnedCollection = {
    loaded: () => undefined,
    created: (record) => collection.created(record),
    built: (record) => collection.built(record),
    invalidate: () => {},
    unsavedCount: () => 0,
    refusal: collection.refusal,
    nullifies: undefined,
    link: collection.link,
    narrowed: () => narrowed,
  };
  return narrowed;
}
