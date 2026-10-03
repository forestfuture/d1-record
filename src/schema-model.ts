import { InvalidModel } from "./errors.ts";
import {
  ignoresColumns,
  type AttributeSpec,
  type AttributeSpecs,
  type AttributeType,
} from "./metadata.ts";
import { Model, type ModelBaseFor } from "./model.ts";
import { bindTable } from "./table-names.ts";

/** One table in a generated schema: its attributes, and which is the primary key. */
export interface TableSchema {
  readonly attributes: AttributeSpecs;
  readonly primaryKey: string;
}

/** A generated schema's tables, by name (`tables` in `src/db/schema.ts`). */
export type TableSchemas = Readonly<Record<string, TableSchema>>;

/** A change to a generated attribute: its type alone, or its type, nullability and default. */
export type AttributeOverride =
  | AttributeType
  | { type?: AttributeType; null?: boolean; default?: () => unknown };

/** What `Model("products", {...})` may change: any attribute, and ignore any but the key. */
export type Overrides<T extends TableSchema> = {
  readonly [K in keyof T["attributes"]]?: K extends T["primaryKey"]
    ? AttributeOverride
    : AttributeOverride | false;
};

type TypeOf<S> = S extends AttributeType ? S : S extends { type: infer T } ? T : never;
type NullOf<S> = S extends { null: false } ? false : true;

/** An attribute's spec with its override applied. */
type Overridden<S, O> = O extends AttributeType
  ? { type: O; null: NullOf<S> }
  : O extends object
    ? {
        type: O extends { type: infer T extends AttributeType } ? T : TypeOf<S>;
        null: O extends { null: infer N extends boolean } ? N : NullOf<S>;
      }
    : S;

/** A table's attributes after its overrides: changed ones merged, ignored ones gone. */
type OverriddenSpecs<A, O> = {
  -readonly [
    K in keyof A as K extends keyof O ? (O[K] extends false ? never : K) : K
  ]: K extends keyof O ? Overridden<A[K], O[K]> : A[K];
};

/** `S` as attribute specs, without widening it to an index signature (which would type any name). */
type AsSpecs<S> = S extends AttributeSpecs ? S : never;

/** Rejects keys that aren't the table's attributes (a generic parameter skips that check). */
type Exactly<O, T extends TableSchema> = O & Record<Exclude<keyof O, keyof T["attributes"]>, never>;

/** The `Model` a generated schema exports: `Model("products")`, or the library's `Model({...})`. */
export interface SchemaModel<T extends TableSchemas> {
  <const N extends keyof T & string, const O extends Overrides<T[N]> = {}>(
    table: N,
    overrides?: Exactly<O, T[N]>,
  ): ModelBaseFor<AsSpecs<OverriddenSpecs<T[N]["attributes"], O>>>;
  <const A extends AttributeSpecs>(specs: A): ModelBaseFor<A>;
}

/** An attribute's spec with one override applied. */
function overridden(spec: AttributeSpec, override: AttributeOverride): AttributeSpec {
  const base = typeof spec === "string" ? { type: spec } : spec;
  return typeof override === "string" ? { ...base, type: override } : { ...base, ...override };
}

/** A table's attribute specs with `overrides` applied; throws `InvalidModel` for a bad one. */
function specsFor(
  name: string,
  table: TableSchema,
  overrides: Readonly<Record<string, AttributeOverride | false>>,
): { specs: AttributeSpecs; ignoring: boolean } {
  const where = `Model("${name}")`;
  for (const [attribute, override] of Object.entries(overrides)) {
    if (!Object.hasOwn(table.attributes, attribute)) {
      throw new InvalidModel(`${where}: ${name} has no attribute ${attribute} to override`);
    }
    if (override === false && attribute === table.primaryKey) {
      throw new InvalidModel(`${where}: the primary key ${attribute} can't be ignored`);
    }
  }
  const specs: AttributeSpecs = {};
  for (const [attribute, spec] of Object.entries(table.attributes)) {
    const override = overrides[attribute];
    if (override === false) continue;
    specs[attribute] = override === undefined ? spec : overridden(spec, override);
  }
  return { specs, ignoring: Object.values(overrides).includes(false) };
}

/**
 * The `Model` for a generated schema (#66): `export const Model = modelFor(tables)` in
 * `src/db/schema.ts`. `Model("products")` is a base class bound to that table, with its
 * attributes and primary key; `Model({...})` is the library's own, for anything else.
 */
export function modelFor<const T extends TableSchemas>(tables: T): SchemaModel<T> {
  function SchemaModel(
    table: string | AttributeSpecs,
    overrides: Readonly<Record<string, AttributeOverride | false>> = {},
  ) {
    if (typeof table !== "string") return Model(table);
    const schema = Object.hasOwn(tables, table) ? tables[table] : undefined;
    if (schema === undefined) {
      throw new InvalidModel(`Model("${table}"): no table named ${table} in this schema`);
    }
    const { specs, ignoring } = specsFor(table, schema, overrides);
    const base = Model(specs);
    bindTable(base, table);
    base.primaryKey = schema.primaryKey;
    if (ignoring) ignoresColumns(base);
    return base;
  }
  return SchemaModel as SchemaModel<T>;
}
