// The rules for each key of an attribute's spec: what it may hold, which types may have it, what
// replaces it, and what a new type drops (#164).
import { epochStorages } from "./epoch-storage.ts";
import type { AttributeType, SpecObject } from "./metadata.ts";

const attributeTypes: readonly unknown[] = [
  "string",
  "integer",
  "real",
  "boolean",
  "datetime",
  "json",
];

/** Whether `value` names an attribute type. */
export function isAttributeType(value: unknown): value is AttributeType {
  return attributeTypes.includes(value);
}

/** A spec's parts that an override may change: any but the column. */
type SpecKey = Exclude<keyof SpecObject, "column">;

/** A spec's keys, as an override gives them: any left out or `undefined` changes nothing. */
export type SpecChange = Partial<Pick<SpecObject, SpecKey>>;

interface KeyRule {
  /** Whether a value is well formed: checked past the types, in plain JavaScript or past a cast. */
  holds(value: unknown): boolean;
  /** How the key reads in a message, if not by its name: `a storage`. */
  label?: string;
  /** The value that means the key isn't given (`generateId: false`); `undefined` always does. */
  off?: unknown;
  /** The only values it may hold, named in the message for any other. */
  oneOf?: readonly string[];
  /** The only types that may have it, and why. */
  onlyFor?: { types: readonly AttributeType[]; because: string };
  /** The keys it can't be given with: one replaces the other when an override gives it. */
  excludes?: readonly SpecKey[];
  /** Dropped when an override gives the attribute a new type, as it was written for the old. */
  dropsOnRetype?: true;
}

/**
 * Every key of a spec but its column, in the order a message lists them. It's typed by
 * `SpecObject`, so a key added there is a compile error until it has its rules here.
 */
const rules: { readonly [K in SpecKey]: KeyRule } = {
  type: { holds: isAttributeType },
  null: { holds: (value) => typeof value === "boolean" },
  default: {
    holds: (value) => typeof value === "function",
    label: "a default",
    excludes: ["generateId"],
    dropsOnRetype: true,
  },
  // A generated id is a string, and comes from generateId alone, not a default as well (#99).
  generateId: {
    holds: (value) => typeof value === "boolean",
    off: false,
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

/** The keys an override may hold, as a message lists them: `type, null, default, …`. */
export const specKeyNames = Object.keys(rules).join(", ");

/** The value of a key if it's given, else `undefined`. */
function givenValue(spec: SpecChange, key: SpecKey): unknown {
  const value = spec[key];
  return value === rules[key].off ? undefined : value;
}

/** Whether `value` is an object holding only spec keys, each well formed or `undefined`. */
export function isSpecChange(value: unknown): value is SpecChange {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.entries(value).every(
    ([key, each]) =>
      Object.hasOwn(rules, key) && (each === undefined || rules[key as SpecKey].holds(each)),
  );
}

/** How a key reads in a message. */
const labelOf = (key: SpecKey): string => rules[key].label ?? key;

/** The problem with `key` given together with a key declared before it that it excludes. */
function exclusionProblem(where: string, spec: SpecChange, index: number): string | undefined {
  const [key, rule] = entries[index]!;
  const earlier = entries
    .slice(0, index)
    .find(([other]) => rule.excludes?.includes(other) && givenValue(spec, other) !== undefined);
  return earlier === undefined
    ? undefined
    : `${where} has both ${labelOf(key)} and ${labelOf(earlier[0])}; keep one`;
}

/** The problem with a given key's value, or with its attribute's type. */
function valueProblem(
  where: string,
  spec: SpecChange & Pick<SpecObject, "type">,
  [key, rule]: [SpecKey, KeyRule],
): string | undefined {
  const value = givenValue(spec, key);
  if (rule.oneOf !== undefined && !rule.oneOf.includes(value as string)) {
    const names = rule.oneOf.map((each) => `"${each}"`).join(" or ");
    return `${where} has ${key} ${JSON.stringify(value)}; use ${names}`;
  }
  if (rule.onlyFor !== undefined && !rule.onlyFor.types.includes(spec.type)) {
    return `${where} is "${spec.type}", so it can't have ${labelOf(key)}: ${rule.onlyFor.because}`;
  }
  return undefined;
}

/**
 * Why a spec can't be as it is, or undefined if it can. `where` names it (`User.id`). A pair of
 * keys that exclude each other is reported from the later one, so it reads as it is declared.
 */
export function specProblem(
  where: string,
  spec: SpecChange & Pick<SpecObject, "type">,
): string | undefined {
  for (const [index, entry] of entries.entries()) {
    if (givenValue(spec, entry[0]) === undefined) continue;
    const problem = exclusionProblem(where, spec, index) ?? valueProblem(where, spec, entry);
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
  const kept = Object.fromEntries(
    Object.entries(base).filter(([key]) => {
      const rule = rules[key as SpecKey] as KeyRule | undefined;
      if (rule?.dropsOnRetype !== true) return true;
      const replaced = entries.some(
        ([other, { excludes }]) =>
          excludes?.includes(key as SpecKey) && givenValue(given, other) !== undefined,
      );
      return !retyped && !replaced;
    }),
  );
  return { ...kept, ...given } as SpecObject;
}
