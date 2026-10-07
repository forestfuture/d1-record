// `belongsTo`, `hasMany` and `hasOne`: the field declarations, and reading a Model's from them.
import type {
  AssociationDeclaration,
  AssociationDefinition,
  AssociationKind,
  AssociationOptions,
  BelongsTo,
  HasMany,
  HasManyDependent,
  HasOne,
  HasOneDependent,
} from "./associations.ts";
import { NoDatabase } from "./errors.ts";
import { withForeignKeys } from "./foreign-keys.ts";
import type { ModelBase, ModelClass } from "./model.ts";
import { modelClassName } from "./table-names.ts";

/** Marks a record field's value as an association declaration, and holds it. */
const declarationKey = Symbol("d1-record association");

/**
 * An association declaration, as a record field's value: `posts = hasMany(Post)`. Its
 * type is the accessor's, so TypeScript knows `user.posts()` with no `declare` line (ADR-0008).
 * Records from `build()` and queries get the real accessor; on a record constructed directly
 * (`new User()`), calling the field throws `NoDatabase`, as any database operation does.
 */
function declaration<A>(kind: AssociationKind, target: ModelClass, options: object): A {
  const field = () => {
    throw new NoDatabase(
      "this record was constructed directly (new …); build or load records through db.model(…) to use its associations",
    );
  };
  // On a record constructed directly, the accessor's methods throw the same way.
  Object.assign(field, { set: field, build: field, create: field, createOrThrow: field });
  // The target's class is passed directly (no `() => Post`): a field's initializer runs when a
  // record is made, by which time every Model class exists, in whatever order they're declared.
  return Object.assign(field, {
    [declarationKey]: { kind, target: () => target, ...options },
  }) as A;
}

/** This record points at one `target` record through `foreignKey` (its own attribute). */
export function belongsTo<C extends ModelClass>(
  target: C,
  options: Omit<AssociationOptions<C>, "dependent"> = {},
): BelongsTo<C> {
  return declaration("belongsTo", target, options);
}

/** Many `target` records point at this record through `foreignKey` (theirs). */
export function hasMany<C extends ModelClass>(
  target: C,
  options: AssociationOptions<C> & { dependent?: HasManyDependent } = {},
): HasMany<C> {
  return declaration("hasMany", target, options);
}

/** One `target` record points at this record through `foreignKey` (its own). */
export function hasOne<C extends ModelClass>(
  target: C,
  options: AssociationOptions<C> & { dependent?: HasOneDependent } = {},
): HasOne<C> {
  return declaration("hasOne", target, options);
}

/**
 * Each Model's associations, read once from a probe record's fields, with foreign keys given
 * or inferred. Module-level, but not request state (ADR-0003): derived only from the class.
 */
const definitions = new WeakMap<object, ReadonlyMap<string, AssociationDefinition>>();

/** One record of each Model, made once, to read its fields. Not request state (ADR-0003). */
const probes = new WeakMap<object, ModelBase>();

/** A Model's probe record: its fields as declared, before any are removed. */
export function probeOf(model: ModelClass): ModelBase {
  let probe = probes.get(model);
  if (probe === undefined) {
    probe = new model();
    probes.set(model, probe);
  }
  return probe;
}

/** The declaration a field holds, if it's an association's. */
export function declarationIn(value: unknown): AssociationDeclaration | undefined {
  return typeof value === "function"
    ? (value as { [declarationKey]?: AssociationDeclaration })[declarationKey]
    : undefined;
}

/**
 * A Model's associations by name, in the order its fields declare them. A Map, so a name every
 * object inherits (`constructor`, from a URL's `?include=`) is never one (#84).
 */
export function associationsOf(model: ModelClass): ReadonlyMap<string, AssociationDefinition> {
  let found = definitions.get(model);
  if (found === undefined) {
    const probe = probeOf(model) as unknown as Record<string, unknown>;
    const declared: Record<string, AssociationDeclaration> = {};
    for (const name of Object.keys(probe)) {
      const field = declarationIn(probe[name]);
      if (field !== undefined) declared[name] = field;
    }
    found = new Map(Object.entries(withForeignKeys(declared, modelClassName(model))));
    definitions.set(model, found);
  }
  return found;
}

/**
 * A new record of `model`, its association fields removed so the accessors on the Model's
 * prototype answer instead. Removed newest first: when they're a record's last fields, as
 * they usually are, that undoes their additions and keeps the object's shape fast.
 */
export function newRecord<M extends ModelBase>(model: ModelClass<M>): M {
  const record = new model();
  const names = [...associationsOf(model).keys()];
  for (let index = names.length - 1; index >= 0; index--) {
    delete (record as unknown as Record<string, unknown>)[names[index]!];
  }
  return record;
}
