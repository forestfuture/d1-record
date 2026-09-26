import type { AssociationDefinition } from "./associations.ts";
import type { IncludeTree } from "./compiler.ts";
import type { Executor } from "./executor.ts";
import type { ModelBase, ModelClass } from "./model.ts";
import { state } from "./record-state.ts";
import { relationFor } from "./scoped-relation.ts";

/** D1 allows at most 100 bound parameters per statement, so keys are sent in groups of 100. */
const KEYS_PER_QUERY = 100;

/**
 * Loads the associations named in `tree` for `records` (all of one Model) and attaches them,
 * then recurses into nested includes. One `WHERE key IN (…)` query per association per group
 * of 100 distinct keys, never one per record.
 */
export async function preload(
  records: readonly ModelBase[],
  tree: IncludeTree,
  executor: Executor,
): Promise<void> {
  const [first] = records;
  if (first === undefined) return;
  const model = first.constructor as ModelClass;
  for (const [name, nested] of Object.entries(tree)) {
    const definition = model.associations[name] as AssociationDefinition;
    const loaded = await preloadOne(records, name, definition, executor);
    await preload(loaded, nested, executor);
  }
}

async function preloadOne(
  records: readonly ModelBase[],
  name: string,
  definition: AssociationDefinition,
  executor: Executor,
): Promise<ModelBase[]> {
  return definition.kind === "belongsTo"
    ? preloadOwners(records, name, definition, executor)
    : preloadTargets(records, name, definition, executor);
}

/** belongsTo: each record gets the one target its foreign key points at, or null. */
async function preloadOwners(
  records: readonly ModelBase[],
  name: string,
  definition: AssociationDefinition,
  executor: Executor,
): Promise<ModelBase[]> {
  const target = definition.target();
  const keyAttribute = definition.primaryKey ?? target.primaryKey;
  const keys = records.map((record) => record[state].read(definition.foreignKey));
  const targets = await loadByKeys(executor, target, keyAttribute, keys);
  const byKey = groupBy(targets, keyAttribute);
  for (const [index, record] of records.entries()) {
    record[state].setPreloaded(name, byKey.get(keys[index])?.[0] ?? null);
  }
  return targets;
}

/** hasMany/hasOne: each record gets the targets pointing at it (hasOne: the first, or null). */
async function preloadTargets(
  records: readonly ModelBase[],
  name: string,
  definition: AssociationDefinition,
  executor: Executor,
): Promise<ModelBase[]> {
  const owner = (records[0] as ModelBase).constructor as ModelClass;
  const ownerKey = definition.primaryKey ?? owner.primaryKey;
  const keys = records.map((record) => record[state].read(ownerKey));
  const targets = await loadByKeys(executor, definition.target(), definition.foreignKey, keys);
  const byKey = groupBy(targets, definition.foreignKey);
  for (const [index, record] of records.entries()) {
    const group = byKey.get(keys[index]) ?? [];
    record[state].setPreloaded(name, definition.kind === "hasMany" ? group : (group[0] ?? null));
  }
  return targets;
}

/** Records grouped by one attribute's value, keeping their order. */
function groupBy(records: readonly ModelBase[], attribute: string): Map<unknown, ModelBase[]> {
  const groups = new Map<unknown, ModelBase[]>();
  for (const record of records) {
    const key = record[state].read(attribute);
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  return groups;
}

/** Target records whose `attribute` is one of `keys`, in target primary-key order. */
async function loadByKeys(
  executor: Executor,
  target: ModelClass,
  attribute: string,
  keys: readonly unknown[],
): Promise<ModelBase[]> {
  const distinct = [...new Set(keys.filter((key) => key !== null && key !== undefined))];
  const loaded: ModelBase[] = [];
  for (let start = 0; start < distinct.length; start += KEYS_PER_QUERY) {
    const group = distinct.slice(start, start + KEYS_PER_QUERY);
    const relation = relationFor(executor, target)
      .where({ [attribute]: group })
      .order({ [target.primaryKey]: "asc" });
    loaded.push(...(await relation.toArray()));
  }
  return loaded;
}
