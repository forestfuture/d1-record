import {
  cachedRead,
  inAssociationOrder,
  linkOf,
  scopedTarget,
  targetOf,
  type AssociationDefinition,
} from "./associations.ts";
import { RecordNotSaved } from "./errors.ts";
import { buildRecord, modelOf, type ModelBase } from "./model.ts";
import { state } from "./record-state.ts";

/**
 * A belongsTo's accessor for `owner`: `await post.author()`, plus `set`, `build`, `create` and
 * `createOrThrow`, as Rails' `post.author =`, `build_author` and `create_author`.
 */
export function belongsToAccessor(
  owner: ModelBase,
  name: string,
  definition: AssociationDefinition,
): unknown {
  const read = () =>
    cachedRead(owner, name, definition, (key, targetAttribute) =>
      scopedTarget(owner[state].executor, modelOf(owner), name, definition).findBy({
        [targetAttribute]: key,
      }),
    );
  const set = (record: ModelBase | null) => pointOwnerAt(owner, name, definition, record);
  const make = (attributes: Record<string, unknown>) =>
    buildRecord(targetOf(definition), attributes, owner[state].executor);
  // Saved first, so the owner points at its new key (the owner itself isn't saved).
  const create =
    (save: (record: ModelBase) => Promise<unknown>) =>
    async (attributes: Record<string, unknown> = {}) => {
      const record = make(attributes);
      await save(record);
      set(record);
      return record;
    };
  return Object.assign(read, {
    set,
    build(attributes: Record<string, unknown> = {}) {
      const record = make(attributes);
      set(record);
      return record;
    },
    create: create((record) => record.save()),
    createOrThrow: create((record) => record.saveOrThrow()),
  });
}

/**
 * Points `owner` at `record` (or at nothing): its foreign key takes the record's key, and the
 * record becomes the loaded association. A new record is saved first when the owner is
 * (autosave), and the key filled in then if D1 generates it.
 */
function pointOwnerAt(
  owner: ModelBase,
  name: string,
  definition: AssociationDefinition,
  record: ModelBase | null,
): void {
  const target = targetOf(definition);
  if (record !== null && !(record instanceof target)) {
    throw new TypeError(
      `${modelOf(owner).name}.${name}.set() takes a ${target.name} record or null`,
    );
  }
  const { ownerAttribute, targetAttribute } = linkOf(definition, modelOf(owner), target);
  const key = record === null ? null : record[state].read(targetAttribute);
  owner[state].pointAt(name, ownerAttribute, key, record);
  owner[state].setBelongsToAutosave(
    name,
    record !== null && record[state].isNew ? record : undefined,
  );
}

/**
 * A hasOne's accessor for `owner`: `await user.profile()`, plus `build`, `create` and
 * `createOrThrow`, as Rails' `build_profile` and `create_profile`. An existing record is left
 * as it is (Rails' replacement rules are #40).
 */
export function hasOneAccessor(
  owner: ModelBase,
  name: string,
  definition: AssociationDefinition,
): unknown {
  const read = () =>
    cachedRead(owner, name, definition, (key, targetAttribute) =>
      inAssociationOrder(
        scopedTarget(owner[state].executor, modelOf(owner), name, definition).where({
          [targetAttribute]: key,
        }),
        targetOf(definition),
      ).first(),
    );
  return Object.assign(read, {
    build(attributes: Record<string, unknown> = {}) {
      const record = buildOne(owner, name, definition, attributes);
      owner[state].addBuilt(name, record);
      return record;
    },
    create: createOne(owner, name, definition, (record) => record.save()),
    createOrThrow: createOne(owner, name, definition, (record) => record.saveOrThrow()),
  });
}

/**
 * A hasOne's `create` or `createOrThrow` (by `save`): needs a saved owner, as in Rails. A
 * record that doesn't save is kept as built, so saving the owner tries again, as Rails does.
 */
function createOne(
  owner: ModelBase,
  name: string,
  definition: AssociationDefinition,
  save: (record: ModelBase) => Promise<unknown>,
) {
  return async (attributes: Record<string, unknown> = {}) => {
    requireSavedOwner(owner, definition);
    const record = buildOne(owner, name, definition, attributes);
    try {
      await save(record);
    } finally {
      if (record[state].isNew) owner[state].addBuilt(name, record);
    }
    return record;
  };
}

/** As in Rails, records can't be created through an owner that hasn't been saved. */
function requireSavedOwner(owner: ModelBase, definition: AssociationDefinition): void {
  if (!owner[state].isNew) return;
  const { name } = modelOf(owner);
  throw new RecordNotSaved(
    `You cannot create a ${targetOf(definition).name} here: the ${name} hasn't been saved; save the ${name} first`,
  );
}

/** A new record of a hasOne, pointing at its owner and loaded as the association. */
function buildOne(
  owner: ModelBase,
  name: string,
  definition: AssociationDefinition,
  attributes: Record<string, unknown>,
): ModelBase {
  const target = targetOf(definition);
  const { ownerAttribute } = linkOf(definition, modelOf(owner), target);
  const key = owner[state].read(ownerAttribute);
  const record = buildRecord(
    target,
    { ...attributes, [definition.foreignKey]: key },
    owner[state].executor,
  );
  owner[state].cacheAssociation(name, { attribute: ownerAttribute, key, value: record });
  return record;
}
