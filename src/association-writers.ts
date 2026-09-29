import {
  cachedRead,
  inAssociationOrder,
  linkOf,
  scopedTarget,
  targetOf,
  type AssociationDefinition,
} from "./associations.ts";
import { RecordNotSaved } from "./errors.ts";
import { buildRecord, type ModelBase, type ModelClass } from "./model.ts";
import { state } from "./record-state.ts";

function modelOf(record: ModelBase): ModelClass {
  return record.constructor as ModelClass;
}

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
  const set = (record: ModelBase | null) => setParent(owner, name, definition, record);
  const make = (attributes: Record<string, unknown>) =>
    buildRecord(targetOf(definition), attributes, owner[state].executor);
  return Object.assign(read, {
    set,
    build(attributes: Record<string, unknown> = {}) {
      const record = make(attributes);
      set(record);
      return record;
    },
    // Saved first, so the owner points at its new key (the owner itself isn't saved).
    async create(attributes: Record<string, unknown> = {}) {
      const record = make(attributes);
      await record.save();
      set(record);
      return record;
    },
    async createOrThrow(attributes: Record<string, unknown> = {}) {
      const record = make(attributes);
      await record.saveOrThrow();
      set(record);
      return record;
    },
  });
}

/**
 * Points `owner` at `record` (or at nothing): its foreign key takes the record's key, and the
 * record becomes the loaded association. A new record is saved first when the owner is
 * (autosave), and the key filled in then if D1 generates it.
 */
function setParent(
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
  owner[state].write(ownerAttribute, key);
  owner[state].cacheAssociation(name, { attribute: ownerAttribute, key, value: record });
  owner[state].setParent(name, record !== null && record[state].isNew ? record : undefined);
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
    async create(attributes: Record<string, unknown> = {}) {
      requireSavedOwner(owner, definition);
      const record = buildOne(owner, name, definition, attributes);
      await record.save();
      return record;
    },
    async createOrThrow(attributes: Record<string, unknown> = {}) {
      requireSavedOwner(owner, definition);
      const record = buildOne(owner, name, definition, attributes);
      await record.saveOrThrow();
      return record;
    },
  });
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
