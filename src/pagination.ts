// `paginate()`: one page of a Relation's records, and its total, in one round trip (#100).
import { compileCount } from "./compiler.ts";
import type { QueryRunner } from "./load.ts";
import type { ModelBase, ModelClass } from "./model.ts";
import type { QueryDescription } from "./query.ts";

/** What `paginate()` takes: which page, how many records on it, and whether to count them all. */
export interface PageOptions {
  /** The page, from 1. */
  page?: number;
  /** Records on a page. */
  perPage?: number;
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

/** A Relation's query and how it runs: what `paginate` pages. */
export interface Paged<M extends ModelBase> {
  model: ModelClass<M>;
  query: QueryDescription;
  runner: QueryRunner<M>;
}

/** One page of `paged`'s records, counted: the `COUNT` and the page's SELECT as one batch. */
export async function paginate<M extends ModelBase>(
  { model, query, runner }: Paged<M>,
  options: PageOptions,
): Promise<Page<M>> {
  const page = options.page ?? 1;
  const perPage = options.perPage ?? 25;
  const order =
    query.order.length > 0
      ? query.order
      : [{ attribute: model.primaryKey, direction: "asc" as const }];
  const { records, count } = await runner.loadCounted(
    { ...query, order, limit: perPage, offset: (page - 1) * perPage },
    compileCount(query),
  );
  const totalPages = Math.ceil(count / perPage);
  return {
    records,
    page,
    perPage,
    total: count,
    totalPages,
    hasNext: page < totalPages,
    hasPrevious: page > 1,
  };
}
