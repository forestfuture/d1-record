// `includes()`: preloading associations, the whole tree planned to go to D1 with its query (#217).
import { attributeFor } from "./attribute.ts";
import type { CompiledSql } from "./compiler.ts";
import type { Executor } from "./executor.ts";
import { selectFor, sendTogether, type Rows } from "./load.ts";
import { hydrate, type ModelBase, type ModelClass } from "./model.ts";
import { LinkedTo, mergeTrees, type IncludeTree, type QueryDescription } from "./query.ts";
import { state } from "./record-state.ts";
import { preloadQuery, type Scoped } from "./relation.ts";
import { resolveAssociation, type ResolvedAssociation } from "./resolved-association.ts";

/** What preloading sends, and how it attaches the rows that come back. */
export interface PreloadPlan {
  /** The statements to send, with the query's own, in one round trip. */
  statements: readonly CompiledSql[];
  /**
   * Attaches the statements' rows, in order, to `records` (one list for each start the plan was
   * made from), then preloads in another round trip what couldn't be planned.
   */
  attach(
    records: readonly (readonly ModelBase[])[],
    rows: readonly Rows[],
    database: Executor,
  ): Promise<void>;
}

/**
 * Whose records a plan starts from: a query's, not yet sent, whose keys each association's
 * query selects with a subquery; or records already loaded, whose keys it binds.
 */
type Owners = { query: QueryDescription } | { records: readonly ModelBase[] };

/**
 * Records of one Model, and the associations to preload for them. `written` is the part of
 * `tree` a caller wrote out, not reached through a scope's includes: it ends, so it's planned
 * in full.
 */
interface Start {
  model: ModelClass;
  owners: Owners;
  tree: IncludeTree;
  written: IncludeTree;
}

/** One association's preload in a plan. */
interface Step {
  association: ResolvedAssociation;
  /** Where its owners are: a plan's start, or after the starts, an earlier step's targets. */
  ownersAt: number;
  /** The SELECT for the targets, or none when nothing can match (no keys, or a `none()` scope). */
  select: CompiledSql | undefined;
}

/** What to preload once records are loaded: for the owners at `ownersAt`, the start's tree. */
interface Afterwards extends Omit<Start, "owners"> {
  ownersAt: number;
}

/** D1's limit of values bound in one statement. */
const BOUND_VALUES = 100;

/**
 * Plans the preloads of `query`'s includes before the query is sent, so they go with it, every
 * level in one round trip: each association's query selects its owners' keys with a subquery
 * of theirs. Throws `IncompatibleRelation`, sending nothing, for a scope that can't be preloaded.
 */
export function planPreload(query: QueryDescription, executor: Executor): PreloadPlan {
  const tree = query.includes ?? {};
  for (const [name, nested] of Object.entries(tree)) {
    checkPreloadable(resolveAssociation(query.model, name), nested, executor);
  }
  return planFrom([{ model: query.model, owners: { query }, tree, written: tree }], executor);
}

/**
 * Throws `IncompatibleRelation` if `association`, or one under it (named in `nested` or its
 * scope's includes), has a scope that can't be preloaded: checked for the whole tree before
 * anything is sent. Each association's scope includes are followed once (`checked`), so a
 * scope that includes itself, a tree of records, still ends.
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

/** The plan preloading each start's tree. */
function planFrom(starts: readonly Start[], executor: Executor): PreloadPlan {
  const planning: Planning = { steps: [], afterwards: [], offset: starts.length, executor };
  starts.forEach((start, ownersAt) => planSteps(planning, start, { ownersAt, path: new Set() }));
  return {
    statements: planning.steps.flatMap((step) => step.select ?? []),
    attach: (records, rows, database) => attachSteps(planning, records, rows, database),
  };
}

/**
 * The steps being planned, what's left until their records are loaded, how many starts come
 * before the steps, and where their queries go.
 */
interface Planning {
  steps: Step[];
  afterwards: Afterwards[];
  offset: number;
  executor: Executor;
}

/** Where a start's steps go: after the position of its records, under the associations above. */
interface Level {
  ownersAt: number;
  path: ReadonlySet<ResolvedAssociation>;
}

/**
 * Adds a step for each association in `start`'s tree, each followed by the steps under it. One
 * in `level`'s path, that a scope's includes reach again (a tree of records) and the caller
 * didn't write out there, is left for afterwards: how deep it goes isn't known until its
 * records are.
 */
function planSteps(planning: Planning, start: Start, level: Level): void {
  const { now, later } = splitRepeated(start, level.path);
  const { model } = start;
  leaveForAfterwards(planning, { ownersAt: level.ownersAt, model, tree: later, written: {} });
  for (const name of Object.keys(now)) planStep(planning, { ...start, tree: now }, level, name);
}

/**
 * Adds the step for one association of `start`'s, then the steps under it. One that, with the
 * subqueries of the levels above, would bind more values than D1 allows is left for
 * afterwards, when its owners' keys are bound as one value.
 */
function planStep(
  planning: Planning,
  { model, owners, tree, written }: Start,
  { ownersAt, path }: Level,
  name: string,
): void {
  const association = resolveAssociation(model, name);
  const query = linkedQuery(association, owners, planning.executor);
  const targets = query && targetsOf(association, query, tree[name] ?? {});
  if (targets !== undefined && "query" in owners && targets.select.params.length > BOUND_VALUES) {
    const part = (from: IncludeTree) => (from[name] === undefined ? {} : { [name]: from[name] });
    leaveForAfterwards(planning, { ownersAt, model, tree: part(tree), written: part(written) });
    return;
  }
  const step = { association, ownersAt, select: targets?.select };
  const position = planning.offset + planning.steps.push(step) - 1;
  if (query === undefined || targets === undefined) return;
  const { target } = association;
  const next = {
    model: target,
    owners: { query },
    tree: targets.includes,
    written: written[name] ?? {},
  };
  planSteps(planning, next, { ownersAt: position, path: new Set([...path, association]) });
}

/** Adds `left` to what's preloaded afterwards, with anything else left for the same owners. */
function leaveForAfterwards(planning: Planning, left: Afterwards): void {
  if (Object.keys(left.tree).length === 0) return;
  const same = planning.afterwards.find(({ ownersAt }) => ownersAt === left.ownersAt);
  if (same === undefined) {
    planning.afterwards.push(left);
    return;
  }
  same.tree = mergeTrees(same.tree, left.tree);
  same.written = mergeTrees(same.written, left.written);
}

/**
 * `association`'s query for its owners' records, in its order: linked by a subquery of the
 * owners' query, or by the loaded owners' keys (one bound value, however many). None when
 * nothing can match: no owner has a key, or the scope is `none()`.
 */
function linkedQuery(
  association: ResolvedAssociation,
  owners: Owners,
  executor: Executor,
): QueryDescription | undefined {
  const { ownerAttribute, targetAttribute } = association;
  if ("query" in owners) {
    const linked = new LinkedTo(targetAttribute, owners.query, ownerAttribute);
    const scoped = scopedQuery(association, association.all(executor));
    return scoped && { ...scoped, conditions: [...scoped.conditions, linked] };
  }
  const keys = owners.records.map((record) => record[state].read(ownerAttribute));
  const distinct = [...new Set(keys.filter((key) => key !== null && key !== undefined))];
  if (distinct.length === 0) return undefined;
  return scopedQuery(association, association.linkedTo(executor, distinct));
}

/** `relation`, of `association`'s targets, in its order, as a preload: none for a `none()`. */
function scopedQuery(
  association: ResolvedAssociation,
  relation: Scoped<ModelBase>,
): QueryDescription | undefined {
  const query = association.inOrder(relation)[preloadQuery](association.label);
  return query.none ? undefined : query;
}

/**
 * `start`'s tree split into the associations to plan now, and those in `path` that the part
 * the caller wrote out doesn't name, for afterwards.
 */
function splitRepeated(
  { model, tree, written }: Start,
  path: ReadonlySet<ResolvedAssociation>,
): { now: IncludeTree; later: IncludeTree } {
  const now: Record<string, IncludeTree> = {};
  const later: Record<string, IncludeTree> = {};
  for (const [name, nested] of Object.entries(tree)) {
    const repeated = written[name] === undefined && path.has(resolveAssociation(model, name));
    (repeated ? later : now)[name] = nested;
  }
  return { now, later };
}

/**
 * Attaches each step's targets, from its statement's rows, to its owners: `records`, a plan's
 * starts, or an earlier step's targets. Then preloads, together in one more round trip, what
 * was left for afterwards.
 */
async function attachSteps(
  { steps, afterwards }: Planning,
  records: readonly (readonly ModelBase[])[],
  rows: readonly Rows[],
  database: Executor,
): Promise<void> {
  const owners = [...records];
  const results = rows.values();
  for (const { association, ownersAt, select } of steps) {
    const found = select === undefined ? [] : (results.next().value ?? []);
    const targets = found.map((row) => hydrate(association.target, row, database));
    attach(owners[ownersAt] ?? [], association, targets);
    owners.push(targets);
  }
  const starts = afterwards.flatMap(({ ownersAt, ...left }): Start[] => {
    const loaded = owners[ownersAt] ?? [];
    return loaded.length === 0 ? [] : [{ ...left, owners: { records: loaded } }];
  });
  if (starts.length > 0) await preloadStarts(starts, database);
}

/** Preloads each start's tree from records already loaded, in one round trip. */
async function preloadStarts(starts: readonly Start[], executor: Executor): Promise<void> {
  const plan = planFrom(starts, executor);
  const rows = await sendTogether(executor, plan.statements);
  const records = starts.map(({ owners }) => ("records" in owners ? owners.records : []));
  await plan.attach(records, rows, executor);
}

/** The SELECT for an association's targets, `query`, and what to preload for them. */
function targetsOf(
  association: ResolvedAssociation,
  query: QueryDescription,
  nested: IncludeTree,
): { select: CompiledSql; includes: IncludeTree } {
  const includes = mergeTrees(query.includes ?? {}, nested);
  // A scope's select keeps the key its records are matched to their owners by (#201).
  const columns = query.select && [...query.select, association.targetAttribute];
  // Given to the SELECT, so the keys the nested includes need are loaded too.
  const select = selectFor(association.target, { ...query, select: columns, includes });
  return { select, includes };
}

/**
 * Attaches `targets`, an association's records, to their owners, `records`: each gets the
 * targets whose linking attribute matches its own (hasMany: all of them; belongsTo/hasOne: the
 * first, or null).
 */
function attach(
  records: readonly ModelBase[],
  association: ResolvedAssociation,
  targets: readonly ModelBase[],
): void {
  const { name, definition, ownerAttribute, target, targetAttribute } = association;
  const byKey = groupBy(targets, targetAttribute);
  // Looked up as the targets hold it: an integer key matches a text foreign key's digits (#94).
  const targetKey = attributeFor(target, targetAttribute);
  for (const record of records) {
    const key = record[state].read(ownerAttribute);
    const group = byKey.get(targetKey.condition(key)) ?? [];
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
