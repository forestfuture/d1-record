// The statics every Model gets from ModelBase: its Relation methods (`Product.where(…)`), typed and defined from one list.
import type { AttributesOf, ModelBase, ModelClass, ScopesOf } from "./model.ts";
import type { PaginateStatic } from "./pagination.ts";
import type { Relation, Scoped } from "./relation.ts";

/** A Model's Relation, as its statics return them: `Product.where(…)` is `Product.all().where(…)`. */
type On<C extends ModelClass> = Scoped<InstanceType<C>, ScopesOf<C>>;

/** The Relation methods every Model has as statics (besides the overloaded ones). */
const relationMethods = [
  "where",
  "whereNot",
  "none",
  "or",
  "merge",
  "order",
  "reorder",
  "limit",
  "offset",
  "select",
  "distinct",
  "includes",
  "build",
  "insert",
  "toInsert",
  "insertAll",
  "toInsertAll",
  "upsert",
  "toUpsert",
  "upsertAll",
  "toUpsertAll",
  "updateAll",
  "toUpdateAll",
  "deleteAll",
  "toDeleteAll",
  "create",
  "createOrThrow",
  "findBy",
  "findByOrThrow",
  "first",
  "last",
  "take",
  "count",
  "size",
  "isEmpty",
  "hasAny",
  "exists",
  "toArray",
  "toSql",
] as const;

/** A Relation method with no overloads, by name. */
type RelationMethod = (typeof relationMethods)[number];

/**
 * A Relation method as a static of every Model, typed for the class it's called on: `Product.where`
 * returns a Relation of `Product`, and on a subclass, of the subclass.
 */
type RelationStatic<K extends RelationMethod> = <C extends ModelClass>(
  this: C,
  ...args: On<C>[K] extends (...args: infer A) => unknown ? A : never
) => On<C>[K] extends (...args: never) => infer R ? R : never;

/** Every Relation method in the list as a static, mapped over Relation's so each keeps its doc comment. */
type RelationStatics = {
  [K in keyof Pick<Relation<ModelBase>, RelationMethod>]: RelationStatic<K>;
};

/** The Relation methods with overloads, typed by hand. */
interface OverloadedStatics {
  paginate: PaginateStatic;
  find: {
    <C extends ModelClass>(this: C, id: string | number): Promise<InstanceType<C>>;
    <C extends ModelClass>(this: C, ids: readonly (string | number)[]): Promise<InstanceType<C>[]>;
    <C extends ModelClass>(
      this: C,
      first: string | number,
      second: string | number,
      ...rest: (string | number)[]
    ): Promise<InstanceType<C>[]>;
  };
  pluck: {
    <C extends ModelClass, K extends keyof AttributesOf<InstanceType<C>> & string>(
      this: C,
      attribute: K,
    ): Promise<AttributesOf<InstanceType<C>>[K][]>;
    <
      C extends ModelClass,
      const K extends readonly [
        keyof AttributesOf<InstanceType<C>> & string,
        keyof AttributesOf<InstanceType<C>> & string,
        ...(keyof AttributesOf<InstanceType<C>> & string)[],
      ],
    >(
      this: C,
      ...attributes: K
    ): Promise<{ -readonly [I in keyof K]: AttributesOf<InstanceType<C>>[K[I]] }[]>;
  };
}

/**
 * The class ModelBase extends, for its statics' types only: at runtime it's empty, and
 * `defineStatics` puts the statics on ModelBase itself, where scopes look for the names they
 * can't take.
 */
export const ModelStatics = class {} as unknown as (abstract new () => object) &
  RelationStatics &
  OverloadedStatics;

/** Defines every Relation method on `base` as a static, as Rails delegates them to `all`. */
export function defineStatics(base: object): void {
  for (const name of [...relationMethods, "find", "pluck", "paginate"]) {
    Object.defineProperty(base, name, {
      value(this: ModelClass, ...args: unknown[]): unknown {
        const relation = this.all() as unknown as Record<string, (...args: unknown[]) => unknown>;
        return relation[name]!(...args);
      },
      writable: true,
      configurable: true,
    });
  }
}
