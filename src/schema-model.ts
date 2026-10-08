// `modelFor` and `ApplicationRecord`: Model base classes built on the generated schema (ADR-0010).
import { InvalidModel } from "./errors.ts";
import {
  generateIdProblem,
  markIgnoringColumns,
  type AttributeSpecs,
  type AttributeType,
  type ExactSpecs,
  type SpecObject,
  type ValueSource,
} from "./metadata.ts";
import {
  defineModel,
  ModelBase,
  type BaseClass,
  type ModelBaseFor,
  type ModelClass,
} from "./model.ts";
import { bindTable } from "./table-names.ts";

/** One table in a generated schema: its attributes, and which is the primary key. */
export interface TableSchema {
  readonly attributes: AttributeSpecs;
  readonly primaryKey: string;
}

/** A generated schema's tables, by name (`tables` in `src/db/schema.ts`). */
export type TableSchemas = Readonly<Record<string, TableSchema>>;

/** An override written out, as read at runtime: any of a spec's parts but its column. */
type ObjectOverride = Partial<Omit<SpecObject, "column">>;

/**
 * A change to a generated attribute: its type alone, or its type, nullability, default and
 * `generateId`, typed so `generateId` goes only with a string, and never with a default (#99).
 */
type AttributeOverride =
  | AttributeType
  | (Pick<ObjectOverride, "null"> & { type?: "string" } & ValueSource)
  | (Pick<ObjectOverride, "null" | "default"> & {
      type: Exclude<AttributeType, "string">;
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

/** The base class `modelFor` makes: `ApplicationRecord("products")`, or the library's `Model({...})`. */
export interface SchemaModel<T extends TableSchemas, B extends BaseClass = typeof ModelBase> {
  <const N extends keyof T & string, const O extends Overrides<T[N]> = {}>(
    table: N,
    overrides?: Exactly<O, T[N]>,
  ): ModelBaseFor<AsSpecs<OverriddenSpecs<T[N]["attributes"], O>>, B>;
  <const A extends AttributeSpecs>(specs: A & ExactSpecs<A>): ModelBaseFor<A, B>;
}

const types: readonly unknown[] = ["string", "integer", "real", "boolean", "datetime", "json"];

/** What each key of an object override may hold (besides `undefined`, which changes nothing). */
const overrideKeys: Readonly<Record<string, (value: unknown) => boolean>> = {
  type: (value) => types.includes(value),
  null: (value) => typeof value === "boolean",
  default: (value) => typeof value === "function",
  generateId: (value) => typeof value === "boolean",
};

/** Whether `value` is an object override: only `type`, `null`, `default` and `generateId`, well formed. */
function isSpecOverride(value: unknown): value is ObjectOverride {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.entries(value).every(
    ([key, each]) =>
      Object.hasOwn(overrideKeys, key) && (each === undefined || overrideKeys[key]!(each)),
  );
}

/**
 * An override as given, checked (TypeScript checks it too, but not in plain JavaScript or past
 * a cast): `false` to ignore the column, or the spec changes, with unset keys left out.
 */
function checked(where: string, attribute: string, override: unknown): ObjectOverride | false {
  if (override === false) return false;
  if (typeof override === "string" && types.includes(override)) {
    return { type: override as AttributeType };
  }
  if (!isSpecOverride(override)) {
    throw new InvalidModel(
      `${where}.${attribute}: an override is a type name, { type, null, default, generateId }, or false`,
    );
  }
  return Object.fromEntries(Object.entries(override).filter(([, value]) => value !== undefined));
}

/**
 * A generated spec with an override applied. A new type drops the generated default or
 * `generateId`, which were written for the old type (#81): the column's own default applies on
 * insert, unless the override gives one. A `default` replaces `generateId`, and `generateId`
 * a `default`, so an attribute has one or the other (#99).
 */
function overridden(spec: AttributeSpecs[string], change: ObjectOverride): AttributeSpecs[string] {
  const base: SpecObject = typeof spec === "string" ? { type: spec } : spec;
  const retyped = change.type !== undefined && change.type !== base.type;
  const { default: initial, generateId, ...rest } = base;
  // A default and generateId replace each other; `generateId: false` leaves a default alone.
  const keepsDefault = !retyped && change.generateId !== true;
  const keepsGenerateId = !retyped && change.default === undefined;
  // Checked by generateIdProblem, since a merged spec's type isn't known statically.
  return {
    ...rest,
    ...(keepsDefault && { default: initial }),
    ...(keepsGenerateId && { generateId }),
    ...change,
  } as AttributeSpecs[string];
}

/** `spec` with `change` applied, refused if it leaves a `generateId` it can't have (#99). */
function checkedOverride(
  where: string,
  spec: AttributeSpecs[string],
  change: ObjectOverride,
): AttributeSpecs[string] {
  const changed = overridden(spec, change);
  const problem = typeof changed === "string" ? undefined : generateIdProblem(where, changed);
  if (problem !== undefined) throw new InvalidModel(problem);
  return changed;
}

/** A table's attribute specs with `overrides` applied; throws `InvalidModel` for a bad one. */
function specsFor(
  name: string,
  table: TableSchema,
  overrides: Readonly<Record<string, unknown>>,
): { specs: AttributeSpecs; ignoring: boolean } {
  const where = name;
  const changes = new Map<string, ReturnType<typeof checked>>();
  for (const [attribute, override] of Object.entries(overrides)) {
    if (override === undefined) continue;
    if (!Object.hasOwn(table.attributes, attribute)) {
      throw new InvalidModel(`${name} has no attribute ${attribute} to override`);
    }
    if (override === false && attribute === table.primaryKey) {
      throw new InvalidModel(`${name}.${attribute} is the primary key, so it can't be ignored`);
    }
    changes.set(attribute, checked(where, attribute, override));
  }
  const specs: AttributeSpecs = {};
  for (const [attribute, spec] of Object.entries(table.attributes)) {
    const change = changes.get(attribute);
    if (change === false) continue;
    specs[attribute] =
      change === undefined ? spec : checkedOverride(`${name}.${attribute}`, spec, change);
  }
  return { specs, ignoring: [...changes.values()].includes(false) };
}

/**
 * The app's base class for a generated schema's Models: `export const ApplicationRecord =
 * modelFor(tables)`, in the `src/models/application-record.ts` that `d1-record schema` writes.
 * `ApplicationRecord("products")` is a base class bound to that table, with its attributes and
 * primary key; `ApplicationRecord({...})` is the library's `Model({...})`, for anything else.
 */
export function modelFor<const T extends TableSchemas, B extends BaseClass = typeof ModelBase>(
  tables: T,
  base: B = ModelBase as unknown as B,
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
    const { specs, ignoring } = specsFor(table, schema, overrides);
    // Generic in the app's base class, so seen here as the library's, which every base extends.
    const model = defineModel(specs, base) as unknown as ModelClass;
    bindTable(model, table);
    model.primaryKey = schema.primaryKey;
    if (ignoring) markIgnoringColumns(model);
    return model;
  }
  return SchemaModel as SchemaModel<T, B>;
}
