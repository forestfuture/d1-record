// `includes()`: preloading associations, one `WHERE key IN (…)` query each, a level's sent together.
import { attributeFor } from "./attribute.ts";
import type { CompiledSql } from "./compiler.ts";
import type { Executor } from "./executor.ts";
import { selectFor } from "./load.ts";
import { hydrate, type ModelBase, type ModelClass } from "./model.ts";
import { mergeTrees, type IncludeTree } from "./query.ts";
import { state } from "./record-state.ts";
import { preloadQuery } from "./relation.ts";
import { resolveAssociation, type ResolvedAssociation } from "./resolved-association.ts";

/** One association to preload for `records`, all of its owner Model. */
interface Preload {
  records: readonly ModelBase[];
  association: ResolvedAssociation;
  /** What to preload for the association's records. */
  nested: IncludeTree;
}

/** A Preload's read: each record's key, and how the targets of all of them are loaded. */
interface Read extends Preload {
  keys: unknown[];
  /** The SELECT for the targets, or none when nothing can match (no keys, or a scope's `none()`). */
  select: CompiledSql | undefined;
  /** What to preload for the targets: what's nested, and the scope's own includes. */
  includes: IncludeTree;
}

/**
 * Loads the associations named in `tree` for `records` (all of one Model) and attaches them,
 * then their nested includes, a level at a time. One `WHERE key IN (…)` query per association,
 * never one per record, and a level's associations, across every branch, go to D1 together:
 * one round trip per level.
 */
export async function preload(
  records: readonly ModelBase[],
  tree: IncludeTree,
  executor: Executor,
): Promise<void> {
  let level = preloadsOf(records, tree);
  for (const { association, nested } of level) checkPreloadable(association, nested, executor);
  while (level.length > 0) level = await loadLevel(level, executor);
}

/**
 * Throws `IncompatibleRelation` if `association`, or one under it (named in `nested` or its
 * scope's includes), has a scope that can't be preloaded: checked for the whole tree before any
 * preload is sent, whatever records each level finds. Each association's scope includes are
 * followed once (`checked`), so a scope that includes itself, a tree of records, still ends.
 */
function checkPreloadable(
  association: ResolvedAssociation,
  nested: IncludeTree,
  executor: Executor,
  checked = new Set<ResolvedAssociation>(),
): void {
  const query = association.all(executor)[preloadQuery](association.label);
  const scoped = checked.has(association) ? {} : (query.includes ?? {});
  checked.add(association);
  for (const [name, under] of Object.entries(mergeTrees(scoped, nested))) {
    checkPreloadable(resolveAssociation(association.target, name), under, executor, checked);
  }
}

/** Loads one level's associations together and attaches them. Resolves to the next level's. */
async function loadLevel(level: readonly Preload[], executor: Executor): Promise<Preload[]> {
  const reads = level.map((step) => readFor(step, executor));
  const rows = await readTogether(
    executor,
    reads.map((read) => read.select),
  );
  return reads.flatMap((read, index) => {
    const found = rows[index] ?? [];
    const targets = found.map((row) => hydrate(read.association.target, row, executor));
    attach(read, targets);
    return preloadsOf(targets, read.includes);
  });
}

/** The associations `tree` names, each to preload for `records`. */
function preloadsOf(records: readonly ModelBase[], tree: IncludeTree): Preload[] {
  const [first] = records;
  if (first === undefined) return [];
  const model = first.constructor as ModelClass;
  return Object.entries(tree).map(([name, nested]) => ({
    records,
    association: resolveAssociation(model, name),
    nested,
  }));
}

/**
 * How `step` reads its records: the association's records linked to any of the keys, in its
 * order, with its scope's includes and those nested under it. One query, whatever the number of
 * keys, since a list is bound as one value.
 */
function readFor(step: Preload, executor: Executor): Read {
  const { records, association, nested } = step;
  const keys = records.map((record) => record[state].read(association.ownerAttribute));
  const distinct = [...new Set(keys.filter((key) => key !== null && key !== undefined))];
  const nothing = { ...step, keys, select: undefined, includes: {} };
  if (distinct.length === 0) return nothing;
  const relation = association.inOrder(association.linkedTo(executor, distinct));
  const query = relation[preloadQuery](association.label);
  if (query.none) return nothing;
  const includes = mergeTrees(query.includes ?? {}, nested);
  // A scope's select keeps the key its records are matched to their owners by (#201).
  const columns = query.select && [...query.select, association.targetAttribute];
  // Given to the SELECT, so the keys the nested includes need are loaded too.
  const select = selectFor(association.target, { ...query, select: columns, includes });
  return { ...step, keys, select, includes };
}

/**
 * The rows of each query, and none for a missing one. The queries go together: one on its own,
 * several as one batch, so one round trip either way, and none for no queries.
 */
async function readTogether(
  executor: Executor,
  queries: readonly (CompiledSql | undefined)[],
): Promise<Record<string, unknown>[][]> {
  const sent = queries.filter((query) => query !== undefined);
  const results = (await sendTogether(executor, sent)).values();
  return queries.map((query) => (query === undefined ? [] : (results.next().value ?? [])));
}

/** The rows of each of `queries`, sent in one round trip. */
async function sendTogether(
  executor: Executor,
  queries: readonly CompiledSql[],
): Promise<Record<string, unknown>[][]> {
  const [only] = queries;
  if (queries.length === 1 && only !== undefined) return [await executor.all(only)];
  return (await executor.batch(queries)).map((result) => result.results);
}

/**
 * Attaches `targets`, a read's records, to its owners: each gets the targets whose linking
 * attribute matches its own (hasMany: all of them; belongsTo/hasOne: the first, or null).
 */
function attach({ records, association, keys }: Read, targets: readonly ModelBase[]): void {
  const { name, definition, ownerAttribute, target, targetAttribute } = association;
  const byKey = groupBy(targets, targetAttribute);
  // Looked up as the targets hold it: an integer key matches a text foreign key's digits (#94).
  const targetKey = attributeFor(target, targetAttribute);
  for (const [index, record] of records.entries()) {
    const group = byKey.get(targetKey.condition(keys[index])) ?? [];
    const value = definition.kind === "hasMany" ? group : (group[0] ?? null);
    // Set, not started as a load: the owners aren't reachable until loading returns, so nothing can write
    // through them meanwhile.
    record[state].associations.set(name, ownerAttribute, value);
  }
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
      // Resolving it makes the owner and its target ready, as any use does.
      const { target } = resolveAssociation(model, name);
      tree = mergeTrees(tree, { [name]: includeTree(target, nested) });
    }
  }
  return tree;
}

/** The attributes a record must have loaded for its includes to be preloaded. */
export function keysForIncludes(model: ModelClass, includes: IncludeTree | undefined): string[] {
  return Object.keys(includes ?? {}).map((name) => resolveAssociation(model, name).ownerAttribute);
}
