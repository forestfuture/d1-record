import { linkOf, type AssociationDefinition } from "./associations.ts";
import { associationOf, type ModelBase, type ModelClass } from "./model.ts";
import { state } from "./record-state.ts";

/** One hasMany's new records, built through it, to save with their owner. */
export interface Autosave {
  name: string;
  definition: AssociationDefinition;
  records: ModelBase[];
}

/**
 * What saving `owner` autosaves: the records built through its hasMany associations that are
 * still new, leaving out any already claimed by the write being prepared.
 */
export function autosavesOf(owner: ModelBase, claimed: ReadonlySet<ModelBase>): Autosave[] {
  const model = modelOf(owner);
  return owner[state]
    .builtRecords()
    .map(([name, built]) => ({
      name,
      definition: associationOf(model, name),
      records: built.filter((record) => record[state].isNew && !claimed.has(record)),
    }))
    .filter(({ records }) => records.length > 0);
}

function modelOf(record: ModelBase): ModelClass {
  return record.constructor as ModelClass;
}

/** The owner's value its records point at; null until D1 generates it, for a new owner. */
function ownerValue(owner: ModelBase, { definition }: Autosave): unknown {
  const owned = linkOf(definition, modelOf(owner), definition.target());
  return owner[state].read(owned.ownerAttribute);
}

/** Whether every record's foreign key can be set before anything is written. */
export function ownerKeysKnown(owner: ModelBase, autosaves: readonly Autosave[]): boolean {
  return autosaves.every((autosave) => ownerValue(owner, autosave) !== null);
}

/**
 * Points every autosaved record at its owner. A hasOne's record stays the owner's loaded
 * association under the owner's new key.
 */
export function linkRecords(owner: ModelBase, autosaves: readonly Autosave[]): void {
  for (const autosave of autosaves) {
    const value = ownerValue(owner, autosave);
    const { definition, name } = autosave;
    for (const record of autosave.records) {
      record[state].write(definition.foreignKey, value);
      if (definition.kind === "hasOne") {
        const attribute = linkOf(definition, modelOf(owner), definition.target()).ownerAttribute;
        owner[state].cacheAssociation(name, { attribute, key: value, value: record });
      }
    }
  }
}

/** A new record a belongsTo points at, saved before its owner (Rails' belongs_to autosave). */
export interface ParentSave {
  name: string;
  definition: AssociationDefinition;
  record: ModelBase;
}

/**
 * The records `owner` was pointed at through belongsTo while they were new. Its foreign keys
 * are linked to them when it's saved, even if they were saved on their own since (Rails links
 * whenever the association was set); the ones still new and unclaimed are saved first.
 */
export function parentsOf(owner: ModelBase): ParentSave[] {
  const model = modelOf(owner);
  return owner[state]
    .parents()
    .map(([name, record]) => ({ name, definition: associationOf(model, name), record }));
}

/** The parents to save before `owner`: new, and not already part of the write. */
export function unsavedParents(
  parents: readonly ParentSave[],
  claimed: ReadonlySet<ModelBase>,
): ModelBase[] {
  return parents
    .map(({ record }) => record)
    .filter((record) => record[state].isNew && !claimed.has(record));
}

/** The attribute of the parent its owner's foreign key holds (its primary key, by default). */
function parentKeyOf(owner: ModelBase, { definition }: ParentSave): string {
  return linkOf(definition, modelOf(owner), definition.target()).targetAttribute;
}

/** Whether every parent's key is known before it's written (generated in code). */
export function parentKeysKnown(owner: ModelBase, parents: readonly ParentSave[]): boolean {
  return parents.every((parent) => parent.record[state].read(parentKeyOf(owner, parent)) !== null);
}

/** Points the owner at its parents, now that their keys exist, and keeps them loaded. */
export function linkParents(owner: ModelBase, parents: readonly ParentSave[]): void {
  for (const parent of parents) {
    const { name, definition, record } = parent;
    const key = record[state].read(parentKeyOf(owner, parent));
    owner[state].write(definition.foreignKey, key);
    owner[state].cacheAssociation(name, { attribute: definition.foreignKey, key, value: record });
    owner[state].setParent(name, undefined);
  }
}
