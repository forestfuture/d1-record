import { linkOf, prepareModel, type AssociationDefinition } from "./associations.ts";
import type { Executor } from "./executor.ts";
import { associationOf, type ModelBase, type ModelClass } from "./model.ts";
import { mergeTrees, type IncludeTree } from "./query.ts";
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

/**
 * Loads one association for `records` and attaches it: each record gets the targets whose
 * linking attribute matches its own (hasMany: all of them; belongsTo/hasOne: the first, or null).
 */
async function preloadOne(
  records: readonly ModelBase[],
  name: string,
  definition: AssociationDefinition,
  executor: Executor,
): Promise<ModelBase[]> {
  const owner = (records[0] as ModelBase).constructor as ModelClass;
  const target = definition.target();
  const { ownerAttribute, targetAttribute } = linkOf(definition, owner, target);
  const keys = records.map((record) => record[state].read(ownerAttribute));
  const targets = await loadByKeys(executor, target, targetAttribute, keys);
  const byKey = groupBy(targets, targetAttribute);
  for (const [index, record] of records.entries()) {
    const group = byKey.get(keys[index]) ?? [];
    const value = definition.kind === "hasMany" ? group : (group[0] ?? null);
    record[state].cacheAssociation(name, { attribute: ownerAttribute, key: keys[index], value });
  }
  return targets;
}

/** Records grouped by one attribute's value, keeping their order. */
function groupBy(records: readonly ModelBase[], attribute: string): Map<unknown, ModelBase[]> {
  const groups = new Map<unknown, ModelBase[]>();
  for (const record of records) {
    const key = record[state].read(attribute);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [record]);
    else group.push(record);
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
  prepareModel(target);
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

/** Normalizes `includes()` arguments into a tree, checking every name against its Model. */
export function includeTree(model: ModelClass, specs: readonly unknown[]): IncludeTree {
  let tree: IncludeTree = {};
  for (const spec of specs) {
    const entries: [string, readonly unknown[]][] =
      typeof spec === "string"
        ? [[spec, []]]
        : Object.entries(spec as Record<string, unknown>).map(([name, nested]) => [
            name,
            Array.isArray(nested) ? nested : [nested],
          ]);
    for (const [name, nested] of entries) {
      const definition = associationOf(model, name);
      const target = definition.target();
      // A Model reached only through includes is still verified and gets its accessors.
      prepareModel(target);
      tree = mergeTrees(tree, { [name]: includeTree(target, nested) });
    }
  }
  return tree;
}

/** The attributes a record must have loaded for its includes to be preloaded. */
export function keysForIncludes(model: ModelClass, includes: IncludeTree | undefined): string[] {
  return Object.keys(includes ?? {}).map((name) => {
    const definition = associationOf(model, name);
    return linkOf(definition, model, definition.target()).ownerAttribute;
  });
}
