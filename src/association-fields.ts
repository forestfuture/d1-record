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
const definitions = new WeakMap<object, Readonly<Record<string, AssociationDefinition>>>();

/** A Model's associations by name, in the order its fields declare them. */
export function associationsOf(model: ModelClass): Readonly<Record<string, AssociationDefinition>> {
  let found = definitions.get(model);
  if (found === undefined) {
    const probe = new model() as unknown as Record<string, unknown>;
    const declared: Record<string, AssociationDeclaration> = {};
    for (const name of Object.keys(probe)) {
      const value = probe[name] as { [declarationKey]?: AssociationDeclaration } | undefined;
      const field = typeof value === "function" ? value[declarationKey] : undefined;
      if (field !== undefined) declared[name] = field;
    }
    found = withForeignKeys(declared, modelClassName(model));
    definitions.set(model, found);
  }
  return found;
}

/**
 * A new record of `model`, its association fields removed so the accessors on the Model's
 * prototype answer instead. Removed newest first, which keeps the object's shape fast.
 */
export function newRecord<M extends ModelBase>(model: ModelClass<M>): M {
  const record = new model();
  const names = Object.keys(associationsOf(model));
  for (let index = names.length - 1; index >= 0; index--) {
    delete (record as unknown as Record<string, unknown>)[names[index]!];
  }
  return record;
}
