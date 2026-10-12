// `paginate()`: one page of a Relation's records, and its total, in one round trip (#100).
import { compileCount } from "./compiler.ts";
import { castValue, uncastable } from "./conversion.ts";
import { IncompatibleRelation } from "./errors.ts";
import type { QueryRunner } from "./load.ts";
import type { ModelBase, ModelClass } from "./model.ts";
import type { OrderTerm, QueryDescription } from "./query.ts";
import { SafeSql } from "./sql.ts";

/** What `paginate()` takes: which page, how many records on it, and whether to count them all. */
export interface PageOptions {
  /** The page, from 1: a number, or untrusted text such as a query string's `"2"`. */
  page?: number | string | null;
  /** Records on a page, a number or text as `page` is. */
  perPage?: number | string | null;
  /** `false` skips the `COUNT`: the page has no `total` or `totalPages`. */
  count?: boolean;
}

/** A page of records, from `paginate({ count: false })`: where it is, but no total. */
export interface CountlessPage<M extends ModelBase> {
  records: M[];
  page: number;
  perPage: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

/** A page of records, from `paginate()`, with the total it's a page of. */
export interface Page<M extends ModelBase> extends CountlessPage<M> {
  total: number;
  totalPages: number;
}

/** `paginate` as a static of every Model, typed for the class it's called on. */
export interface PaginateStatic {
  <C extends ModelClass>(
    this: C,
    options: PageOptions & { count: false },
  ): Promise<CountlessPage<InstanceType<C>>>;
  <C extends ModelClass>(
    this: C,
    options?: PageOptions & { count?: true },
  ): Promise<Page<InstanceType<C>>>;
  <C extends ModelClass>(
    this: C,
    options: PageOptions,
  ): Promise<Page<InstanceType<C>> | CountlessPage<InstanceType<C>>>;
}

/** A Relation's query and how it runs: what `paginate` pages. */
export interface Paged<M extends ModelBase> {
  model: ModelClass<M>;
  query: QueryDescription;
  runner: QueryRunner<M>;
}

/**
 * One page of `paged`'s records. Counted, the `COUNT` and the page's SELECT go as one batch;
 * with `count: false`, one SELECT fetches a record past the page to learn whether there's a next.
 */
export async function paginate<M extends ModelBase>(
  { model, query, runner }: Paged<M>,
  options: PageOptions,
): Promise<Page<M> | CountlessPage<M>> {
  if (query.limit !== undefined || query.offset !== undefined) {
    throw new IncompatibleRelation(
      "paginate() pages with its own limit and offset; remove the Relation's limit() and offset()",
    );
  }
  const page = pageNumber("page", options.page) ?? 1;
  const perPage = Math.min(
    pageNumber("perPage", options.perPage) ?? model.perPage,
    model.maxPerPage,
  );
  const onPage = {
    ...query,
    order: stableOrder(model, query),
    limit: perPage,
    offset: offsetOf(page, perPage),
  };
  const hasPrevious = page > 1;
  if (options.count === false) {
    const { records, hasMore } = await runner.loadAhead(onPage);
    return { records, page, perPage, hasNext: hasMore, hasPrevious };
  }
  const { records, count } = await runner.loadCounted(onPage, compileCount(query));
  const totalPages = Math.ceil(count / perPage);
  const hasNext = page < totalPages;
  return { records, page, perPage, total: count, totalPages, hasNext, hasPrevious };
}

/**
 * The rows before `page`. A page so far that the rows to it (and one more, for `count: false`)
 * aren't a safe integer is a `TypeError`, as an uncastable page is, rather than an inexact offset.
 */
function offsetOf(page: number, perPage: number): number {
  const offset = (page - 1) * perPage;
  if (!Number.isSafeInteger(offset + perPage + 1)) {
    throw new TypeError("paginate()'s page is too far to reach");
  }
  return offset;
}

/**
 * `query`'s order, ended with what makes a row unique, so tied rows keep their pages between
 * requests: the primary key, or after `distinct()`, the selected attributes (the key isn't
 * loaded). Those already in the order aren't added again.
 */
function stableOrder(model: ModelClass, query: QueryDescription): readonly OrderTerm[] {
  const unique = query.distinct && query.select ? query.select : [model.primaryKey];
  const ordered = new Set(query.order.map((term) => !(term instanceof SafeSql) && term.attribute));
  const ties = unique
    .filter((attribute) => !ordered.has(attribute))
    .map((attribute) => ({ attribute, direction: "asc" as const }));
  return [...query.order, ...ties];
}

/**
 * A page or page size, cast as an integer attribute is (#81), so `"2"` is 2. Missing, `null` or
 * `""` is `undefined`, for the default; anything else not a whole number from 1 is a `TypeError`.
 */
function pageNumber(name: string, value: number | string | null | undefined): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const cast = castValue({ type: "integer" }, value);
  if (cast === uncastable || (cast as number) < 1) {
    throw new TypeError(`paginate()'s ${name} must be a whole number from 1`);
  }
  return cast as number;
}
