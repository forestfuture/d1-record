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
  /**
   * Starts a load from D1, called before its query is sent; the function it returns takes the
   * rows and gives the load's own records (then those built). It keeps them only if nothing
   * changed the association meanwhile (#181). Only the association itself has it, not narrowed ones.
   */
  startFill?<M extends ModelBase>(): (records: readonly M[]) => M[];
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
  const { associations: loadedAssociations, autosaves } = owner[state];
  const { name, ownerAttribute, definition } = association;
  const built = () => autosaves.built(name);
  // The stored records, then those built through it and not among them, as Rails merges new
  // records into what it loads.
  const withBuilt = <M extends ModelBase>(stored: readonly M[]): M[] => [
    ...stored,
    // Built through this association, so they're of its target Model, as the stored ones are.
    ...(built().filter((record) => !stored.includes(record as M)) as M[]),
  ];
  const collection: OwnedCollection = {
    loaded() {
      const stored = loadedAssociations.get(name)?.value as ModelBase[] | undefined;
      return stored === undefined ? undefined : withBuilt(stored);
    },
    startFill<M extends ModelBase>() {
      const keep = loadedAssociations.startLoad(name, ownerAttribute, key);
      return (records: readonly M[]) => {
        keep(records);
        return withBuilt(records);
      };
    },
    created(record) {
      const loaded = collection.loaded();
      // Not loaded: nothing to add to, but a load already sent mustn't land without the record.
      if (loaded === undefined) {
        loadedAssociations.clear(name);
        return;
      }
      const index = indexOfRow(loaded, record, association.target.primaryKey);
      // A copy loaded by an overlapping read gives way to the record itself, where it stood.
      loadedAssociations.set(
        name,
        ownerAttribute,
        index === -1
          ? [...loaded, record]
          : loaded.map((each, at) => (at === index ? record : each)),
      );
    },
    built: (record) => autosaves.addBuilt(name, record),
    invalidate: () => loadedAssociations.clear(name),
    unsavedCount: () => built().filter((record) => record[state].isNew).length,
    refusal: undefined,
    nullifies: association.deletesOnDeleteAll ? undefined : definition.foreignKey,
    link: { attribute: definition.foreignKey, association: name },
    narrowed: () => narrowedOf(collection),
  };
  return collection;
}

/**
 * Where `records` hold `record`'s row, or -1. By primary key, not identity: a read sent after the
 * record's INSERT and answered before its create finished loaded its own copy of the row (#181).
 */
function indexOfRow(records: readonly ModelBase[], record: ModelBase, primaryKey: string): number {
  const key = record[state].read(primaryKey);
  return records.findIndex((loaded) => Object.is(loaded[state].read(primaryKey), key));
}

/** An owner without a key: no stored records, just what was built through it. */
function withoutKey(owner: ModelBase, association: ResolvedAssociation): OwnedCollection {
  const { name, definition } = association;
  const collection: OwnedCollection = {
    loaded: () => [...owner[state].autosaves.built(name)],
    created: () => {},
    built: (record) => owner[state].autosaves.addBuilt(name, record),
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
