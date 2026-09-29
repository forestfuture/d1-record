import { prepareModel } from "./associations.ts";
import type { Executor } from "./executor.ts";
import { associationOf, type ModelBase, type ModelClass } from "./model.ts";
import { mergeTrees, type IncludeTree } from "./query.ts";
import { state } from "./record-state.ts";
import { requirePreloadable } from "./relation.ts";
import { resolveAssociation, type ResolvedAssociation } from "./resolved-association.ts";

/**
 * Loads the associations named in `tree` for `records` (all of one Model) and attaches them,
 * then recurses into nested includes. One `WHERE key IN (…)` query per association, never one
 * per record.
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
    const loaded = await preloadOne(records, resolveAssociation(model, name), executor);
    await preload(loaded, nested, executor);
  }
}

/**
 * Loads one association for `records` and attaches it: each record gets the targets whose
 * linking attribute matches its own (hasMany: all of them; belongsTo/hasOne: the first, or null).
 */
async function preloadOne(
  records: readonly ModelBase[],
  association: ResolvedAssociation,
  executor: Executor,
): Promise<ModelBase[]> {
  const { name, definition, ownerAttribute, targetAttribute } = association;
  const keys = records.map((record) => record[state].read(ownerAttribute));
  const targets = await loadByKeys(association, executor, keys);
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

/**
 * The association's records linked to any of `keys`, in its order: one query, whatever the
 * number of keys, since a list is bound as one value.
 */
async function loadByKeys(
  association: ResolvedAssociation,
  executor: Executor,
  keys: readonly unknown[],
): Promise<ModelBase[]> {
  const distinct = [...new Set(keys.filter((key) => key !== null && key !== undefined))];
  if (distinct.length === 0) return [];
  const records = association.records(executor, distinct)[requirePreloadable](association.label);
  return association.inOrder(records).toArray();
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
  return Object.keys(includes ?? {}).map((name) => resolveAssociation(model, name).ownerAttribute);
}
