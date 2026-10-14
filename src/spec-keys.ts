// The rules for each key of an attribute's spec: what it may hold, where it's allowed, what it excludes (#164).
// A key's rules are written here once, and the override merge, the override check, a Model's check
// and the attribute's definition all read them.
import { epochStorages } from "./epoch-storage.ts";
import type { AttributeDefinition, AttributeType, SpecObject } from "./metadata.ts";

/** Typed by `AttributeType`, so a new type is a compile error here until it's listed. */
const typeNames = {
  string: true,
  integer: true,
  real: true,
  boolean: true,
  datetime: true,
  json: true,
} satisfies Record<AttributeType, true>;

const attributeTypes: readonly unknown[] = Object.keys(typeNames);

/** Whether `value` names an attribute type. */
export function isAttributeType(value: unknown): value is AttributeType {
  return attributeTypes.includes(value);
}

/** A part of a spec. */
type SpecKey = keyof SpecObject;

/** The parts of a spec an override may change (not the column), any left out or `undefined` unchanged. */
export type SpecChange = Partial<Omit<SpecObject, "column">>;

interface KeyRule {
  /** Whether a value is well formed: checked past the types, in plain JavaScript or past a cast. */
  holds: (value: unknown) => boolean;
  /** How the key reads in a message, if not by its name: `a storage`. */
  label?: string;
  /** Whether a value gives the key; by default any but `undefined` (`generateId: false` doesn't). */
  isGiven?: (value: unknown) => boolean;
  /** The only values it may hold, named in the message for any other. */
  oneOf?: readonly string[];
  /** The only types that may have it, and why. */
  onlyFor?: { types: readonly AttributeType[]; because: string };
  /**
   * Keys it can't be given with. Declared on one of the two: it holds both ways, and the
   * message names the declaring key first. An override that gives one replaces the other.
   */
  excludes?: readonly SpecKey[];
  /** Dropped when an override gives the attribute a new type, as it was written for the old. */
  dropsOnRetype?: true;
  /** `false` for a key an override can't change. */
  overridable?: false;
  /**
   * `false` for a key `define` doesn't copy into the attribute's definition as given: the type
   * and column, which it resolves, and nullability, which a definition doesn't hold.
   */
  carried?: false;
}

/**
 * Every key of a spec, in the order a message lists them. It's typed by `SpecObject`, so a key
 * added there is a compile error until it has its rules here.
 */
const rules: { readonly [K in SpecKey]: KeyRule } = {
  type: { holds: isAttributeType, carried: false },
  null: { holds: (value) => typeof value === "boolean", carried: false },
  column: { holds: (value) => typeof value === "string", overridable: false, carried: false },
  default: {
    holds: (value) => typeof value === "function",
    label: "a default",
    dropsOnRetype: true,
  },
  // A generated id is a string, and comes from generateId alone, not a default as well (#99).
  generateId: {
    holds: (value) => typeof value === "boolean",
    isGiven: (value) => value === true,
    onlyFor: { types: ["string"], because: "generated ids are strings" },
    excludes: ["default"],
    dropsOnRetype: true,
  },
  // Only a datetime is stored as a Unix epoch, in seconds or milliseconds (#73).
  storage: {
    holds: (value) => typeof value === "string",
    label: "a storage",
    oneOf: epochStorages,
    onlyFor: { types: ["datetime"], because: "only a datetime is stored as an epoch" },
    dropsOnRetype: true,
  },
};

const entries = Object.entries(rules) as [SpecKey, KeyRule][];

/** For each key, the keys it can't be given with, whichever of the two declares it. */
const excluding = new Map<SpecKey, SpecKey[]>(entries.map(([key]) => [key, []]));
for (const [key, { excludes = [] }] of entries) {
  for (const other of excludes) {
    excluding.get(key)!.push(other);
    excluding.get(other)!.push(key);
  }
}

/** The keys an override may hold, as a message lists them: `type, null, default, …`. */
export const specKeyNames = entries
  .filter(([, rule]) => rule.overridable !== false)
  .map(([key]) => key)
  .join(", ");

/** The value of a key if it's given, else `undefined`. */
function givenValue(spec: Partial<SpecObject>, key: SpecKey): unknown {
  const value = spec[key];
  const isGiven = rules[key].isGiven ?? ((each: unknown) => each !== undefined);
  return isGiven(value) ? value : undefined;
}

/** How a key reads in a message. */
const labelOf = (key: SpecKey): string => rules[key].label ?? key;

/** Whether `value` is an object holding only spec keys an override may change, each well formed or `undefined`. */
export function isSpecChange(value: unknown): value is SpecChange {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, each]) => {
    if (!Object.hasOwn(rules, key) || rules[key as SpecKey].overridable === false) return false;
    return each === undefined || rules[key as SpecKey].holds(each);
  });
}

/** The problem with `key` given together with a key it excludes. */
function exclusionProblem(
  where: string,
  spec: Partial<SpecObject>,
  key: SpecKey,
): string | undefined {
  const other = rules[key].excludes?.find((each) => givenValue(spec, each) !== undefined);
  return other === undefined
    ? undefined
    : `${where} has both ${labelOf(key)} and ${labelOf(other)}; keep one`;
}

/** A value as a message shows it: as JSON, or as text for one JSON can't write (a BigInt). */
function shown(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** The problem with a given key's value, or with its attribute's type. */
function valueProblem(
  where: string,
  spec: SpecChange & Pick<SpecObject, "type">,
  key: SpecKey,
): string | undefined {
  const { oneOf, onlyFor } = rules[key];
  const value = givenValue(spec, key);
  if (oneOf !== undefined && !oneOf.includes(value as string)) {
    const names = oneOf.map((each) => `"${each}"`).join(" or ");
    return `${where} has ${key} ${shown(value)}; use ${names}`;
  }
  if (onlyFor !== undefined && !onlyFor.types.includes(spec.type)) {
    return `${where} is "${spec.type}", so it can't have ${labelOf(key)}: ${onlyFor.because}`;
  }
  return undefined;
}

/** Why a spec can't be as it is, or undefined if it can. `where` names it (`User.id`). */
export function specProblem(
  where: string,
  spec: SpecChange & Pick<SpecObject, "type">,
): string | undefined {
  for (const [key] of entries) {
    if (givenValue(spec, key) === undefined) continue;
    const problem = exclusionProblem(where, spec, key) ?? valueProblem(where, spec, key);
    if (problem !== undefined) return problem;
  }
  return undefined;
}

/**
 * `base` with `change` applied. A key `change` gives replaces one it excludes, and a new type
 * drops every key written for the old one (so the column's own default applies on insert, unless
 * the change gives one, #81).
 */
export function applyChange(base: SpecObject, change: SpecChange): SpecObject {
  const given = Object.fromEntries(
    Object.entries(change).filter(([, value]) => value !== undefined),
  );
  const retyped = given.type !== undefined && given.type !== base.type;
  const dropped = new Set(
    entries
      .filter(([key, rule]) => {
        const replaced = excluding
          .get(key)!
          .some((other) => givenValue(given, other) !== undefined);
        return rule.dropsOnRetype === true && (retyped || replaced);
      })
      .map(([key]) => key),
  );
  const kept = Object.entries(base).filter(([key]) => !dropped.has(key as SpecKey));
  return { ...Object.fromEntries(kept), ...given } as SpecObject;
}

/** The keys of `spec` that go into its attribute's definition as given: `default`, `generateId`, `storage`. */
export function carriedKeys(
  spec: SpecObject,
): Partial<Pick<AttributeDefinition, "default" | "generateId" | "storage">> {
  const carried = entries
    .filter(([key, rule]) => rule.carried !== false && givenValue(spec, key) !== undefined)
    .map(([key]) => [key, spec[key]]);
  return Object.fromEntries(carried);
}
