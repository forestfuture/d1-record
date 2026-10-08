// `paginate()`: one page of a Relation's records, and its total, in one round trip (#100).
import { compileCount } from "./compiler.ts";
import { castValue, uncastable } from "./conversion.ts";
import type { QueryRunner } from "./load.ts";
import type { ModelBase, ModelClass } from "./model.ts";
import type { QueryDescription } from "./query.ts";

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
  const page = whole("page", options.page) ?? 1;
  const perPage = whole("perPage", options.perPage) ?? 25;
  const order =
    query.order.length > 0
      ? query.order
      : [{ attribute: model.primaryKey, direction: "asc" as const }];
  const onPage = { ...query, order, limit: perPage, offset: (page - 1) * perPage };
  const hasPrevious = page > 1;
  if (options.count === false) {
    const records = await runner.load({ ...onPage, limit: perPage + 1 });
    const hasNext = records.length > perPage;
    return { records: records.slice(0, perPage), page, perPage, hasNext, hasPrevious };
  }
  const { records, count } = await runner.loadCounted(onPage, compileCount(query));
  const totalPages = Math.ceil(count / perPage);
  const hasNext = page < totalPages;
  return { records, page, perPage, total: count, totalPages, hasNext, hasPrevious };
}

/**
 * A page or page size, cast as an integer attribute is (#81), so `"2"` is 2. Missing, `null` or
 * `""` is `undefined`, for the default; anything else not a whole number from 1 is a `TypeError`.
 */
function whole(name: string, value: number | string | null | undefined): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const cast = castValue("integer", value);
  if (cast === uncastable || (cast as number) < 1) {
    throw new TypeError(`paginate()'s ${name} must be a whole number from 1`);
  }
  return cast as number;
}
