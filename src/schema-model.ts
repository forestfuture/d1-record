// `modelFor` and `ApplicationRecord`: Model base classes built on the generated schema (ADR-0010).
import { InvalidModel } from "./errors.ts";
import {
  type AttributeSpecs,
  type AttributeType,
  type ExactSpecs,
  type ValueSource,
} from "./metadata.ts";
import { defineModel, Model, type BaseClass, type ModelBaseFor, type ModelClass } from "./model.ts";
import { specsFor, type TableSchema, type TableSchemas } from "./generated-model.ts";
import type { SpecOverride } from "./spec-keys.ts";
import { bindTable } from "./table-names.ts";

/**
 * A change to a generated attribute: its type alone, or its type, nullability, default and
 * `generateId`, typed so `generateId` goes only with a string, and never with a default (#99).
 */
type AttributeOverride =
  | AttributeType
  | (Pick<SpecOverride, "null"> & { type?: "string"; storage?: never } & ValueSource)
  | (Pick<SpecOverride, "null" | "default"> & {
      type: Exclude<AttributeType, "string" | "datetime">;
      generateId?: false;
      storage?: never;
    })
  | (Pick<SpecOverride, "null" | "default" | "storage"> & {
      type: "datetime";
      generateId?: false;
    });

/** What `ApplicationRecord("products", {...})` may change: any attribute, and ignore any but the key. */
type Overrides<T extends TableSchema> = {
  readonly [K in keyof T["attributes"]]?: K extends T["primaryKey"]
    ? AttributeOverride
    : AttributeOverride | false;
};

/** The type a spec declares, written either way. */
type TypeOf<S> = S extends AttributeType ? S : S extends { type: infer T } ? T : never;
/** Whether a spec's attribute can be `null`. */
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

/** The base class `modelFor` makes: `ApplicationRecord("products")`, or the library's `Model.define({...})`. */
export interface SchemaModel<T extends TableSchemas, B extends BaseClass = typeof Model> {
  <const N extends keyof T & string, const O extends Overrides<T[N]> = {}>(
    table: N,
    overrides?: Exactly<O, T[N]>,
  ): ModelBaseFor<AsSpecs<OverriddenSpecs<T[N]["attributes"], O>>, B>;
  <const A extends AttributeSpecs>(specs: A & ExactSpecs<A>): ModelBaseFor<A, B>;
}

/**
 * The app's base class for a generated schema's Models: `export const ApplicationRecord =
 * modelFor(tables)`, in the `src/models/application-record.ts` that `d1-record schema` writes.
 * `ApplicationRecord("products")` is a base class bound to that table, with its attributes and
 * primary key; `ApplicationRecord({...})` is the library's `Model.define({...})`, for anything else.
 */
export function modelFor<const T extends TableSchemas, B extends BaseClass = typeof Model>(
  tables: T,
  base: B = Model as unknown as B,
): SchemaModel<T, B> {
  function SchemaModel(
    table: string | AttributeSpecs,
    overrides: Readonly<Record<string, unknown>> = {},
  ) {
    if (typeof table !== "string") return defineModel(table, base);
    const schema = Object.hasOwn(tables, table) ? tables[table] : undefined;
    if (schema === undefined) {
      throw new InvalidModel(`There's no table named ${table} in the generated schema`);
    }
    const { specs, ignoresColumns } = specsFor(table, schema, overrides);
    // Generic in the app's base class, so seen here as the library's, which every base extends.
    const model = defineModel(specs, base) as unknown as ModelClass;
    bindTable(model, table, { ignoresColumns });
    model.primaryKey = schema.primaryKey;
    return model;
  }
  return SchemaModel as SchemaModel<T, B>;
}
