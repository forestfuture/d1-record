import type { Errors } from "./errors-collection.ts";

export interface LengthOptions {
  minimum?: number;
  maximum?: number;
  is?: number;
}

export interface NumericalityOptions {
  onlyInteger?: boolean;
  greaterThan?: number;
  greaterThanOrEqualTo?: number;
  lessThan?: number;
  lessThanOrEqualTo?: number;
}

/** The rules for one `validates(attribute, options)` call. `R` is the Model's record type. */
export interface ValidationOptions<R = never> {
  /** Not null, and not blank after trimming a string. */
  presence?: boolean;
  length?: LengthOptions;
  format?: RegExp | { with: RegExp };
  inclusion?: readonly unknown[] | { in: readonly unknown[] };
  numericality?: boolean | NumericalityOptions;
  /** Skip these rules when the value is null. */
  allowNull?: boolean;
  /** Replaces the default message of every failure from these rules. */
  message?: string;
  /** Only run these rules when this returns true. */
  if?: (record: R) => boolean;
}

/** One `validates(attribute, options)` declaration. */
export interface Validation {
  attribute: string;
  options: ValidationOptions<never>;
}

interface Failure {
  type: string;
  message: string;
}

type Check = (value: unknown, options: ValidationOptions<never>) => Failure[];

function isBlank(value: unknown): boolean {
  return value === null || (typeof value === "string" && value.trim() === "");
}

const presence: Check = (value, { presence: required }) =>
  required && isBlank(value) ? [{ type: "blank", message: "can't be blank" }] : [];

const length: Check = (value, { length: rule }) => {
  if (rule === undefined) return [];
  const size = typeof value === "string" ? value.length : 0;
  const failures: Failure[] = [];
  if (rule.is !== undefined && size !== rule.is) {
    failures.push({
      type: "wrongLength",
      message: `is the wrong length (should be ${rule.is} characters)`,
    });
  }
  if (rule.minimum !== undefined && size < rule.minimum) {
    failures.push({
      type: "tooShort",
      message: `is too short (minimum is ${rule.minimum} characters)`,
    });
  }
  if (rule.maximum !== undefined && size > rule.maximum) {
    failures.push({
      type: "tooLong",
      message: `is too long (maximum is ${rule.maximum} characters)`,
    });
  }
  return failures;
};

const format: Check = (value, { format: rule }) => {
  if (rule === undefined) return [];
  const pattern = rule instanceof RegExp ? rule : rule.with;
  const matches = typeof value === "string" && pattern.test(value);
  return matches ? [] : [{ type: "invalid", message: "is invalid" }];
};

const inclusion: Check = (value, { inclusion: rule }) => {
  if (rule === undefined) return [];
  const allowed = Array.isArray(rule) ? rule : (rule as { in: readonly unknown[] }).in;
  return allowed.includes(value)
    ? []
    : [{ type: "inclusion", message: "is not included in the list" }];
};

const COMPARISONS = [
  ["greaterThan", "must be greater than", (a: number, b: number) => a > b],
  ["greaterThanOrEqualTo", "must be greater than or equal to", (a: number, b: number) => a >= b],
  ["lessThan", "must be less than", (a: number, b: number) => a < b],
  ["lessThanOrEqualTo", "must be less than or equal to", (a: number, b: number) => a <= b],
] as const;

/** Only real numbers pass; a numeric string like "12" is not a number (convert input first). */
const numericality: Check = (value, { numericality: rule }) => {
  if (rule === undefined || rule === false) return [];
  if (typeof value !== "number" || Number.isNaN(value)) {
    return [{ type: "notANumber", message: "is not a number" }];
  }
  const options = rule === true ? {} : rule;
  if (options.onlyInteger && !Number.isInteger(value)) {
    return [{ type: "notAnInteger", message: "must be an integer" }];
  }
  return COMPARISONS.flatMap(([type, words, holds]) => {
    const bound = options[type];
    return bound === undefined || holds(value, bound)
      ? []
      : [{ type, message: `${words} ${bound}` }];
  });
};

/** Applied in this order within one `validates` call. */
const CHECKS: readonly Check[] = [presence, length, format, inclusion, numericality];

/** Runs every validation in declaration order, adding failures to `errors`. */
export async function runValidations(
  record: unknown,
  validations: readonly Validation[],
  read: (attribute: string) => unknown,
  errors: Errors,
): Promise<void> {
  for (const { attribute, options } of validations) {
    if (options.if && !options.if(record as never)) continue;
    const value = read(attribute);
    if (options.allowNull && value === null) continue;
    for (const failure of CHECKS.flatMap((check) => check(value, options))) {
      errors.add(attribute, options.message ?? failure.message, { type: failure.type });
    }
  }
}
