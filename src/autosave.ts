import { linkOf, type AssociationDefinition } from "./associations.ts";
import { associationOf, modelOf, type ModelBase } from "./model.ts";
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
export interface BelongsToAutosave {
  name: string;
  definition: AssociationDefinition;
  record: ModelBase;
}

/**
 * The records `owner` was pointed at through belongsTo while they were new. Its foreign keys
 * are linked to them when it's saved, even if they were saved on their own since (Rails links
 * whenever the association was set); the ones still new and unclaimed are saved first.
 */
export function belongsToAutosavesOf(owner: ModelBase): BelongsToAutosave[] {
  const model = modelOf(owner);
  return owner[state]
    .belongsToAutosaves()
    .map(([name, record]) => ({ name, definition: associationOf(model, name), record }));
}

/** The records `owner` points at to save before it: new, and not already part of the write. */
export function unsavedBelongsTo(
  pointedAt: readonly BelongsToAutosave[],
  claimed: ReadonlySet<ModelBase>,
): ModelBase[] {
  return pointedAt
    .map(({ record }) => record)
    .filter((record) => record[state].isNew && !claimed.has(record));
}

/** The attribute of the pointed-at record its owner's foreign key holds (its primary key, by default). */
function belongsToKeyOf(owner: ModelBase, { definition }: BelongsToAutosave): string {
  return linkOf(definition, modelOf(owner), definition.target()).targetAttribute;
}

/** Whether every pointed-at record's key is known before it's written (generated in code). */
export function belongsToKeysKnown(
  owner: ModelBase,
  pointedAt: readonly BelongsToAutosave[],
): boolean {
  return pointedAt.every((each) => each.record[state].read(belongsToKeyOf(owner, each)) !== null);
}

/** Points the owner at the records it points at, now that their keys exist, keeping them loaded. */
export function linkBelongsTo(owner: ModelBase, pointedAt: readonly BelongsToAutosave[]): void {
  for (const each of pointedAt) {
    const { name, definition, record } = each;
    const key = record[state].read(belongsToKeyOf(owner, each));
    owner[state].pointAt(name, definition.foreignKey, key, record);
    owner[state].setBelongsToAutosave(name, undefined);
  }
}
