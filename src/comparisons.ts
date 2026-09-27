declare const comparedType: unique symbol;

type Operator = ">" | ">=" | "<" | "<=" | "between" | "from";

/**
 * A comparison condition for one attribute: `where({ age: gte(18) })`. Made by `gt`, `gte`,
 * `lt`, `lte` and `between`; a class, so it's never mistaken for a json attribute's value.
 */
export class Comparison<T = unknown> {
  /** Type-only: the compared value's type, checked against the attribute's. */
  declare readonly [comparedType]?: T;

  readonly operator: Operator;
  readonly values: readonly unknown[];

  /** @internal Use `gt`, `gte`, `lt`, `lte` or `between`. */
  constructor(operator: Operator, values: readonly unknown[]) {
    for (const value of values) {
      if (value === null || value === undefined) {
        throw new TypeError(
          `A comparison needs a value, not ${String(value)}; use where({ attribute: null }) to match NULL`,
        );
      }
    }
    this.operator = operator;
    this.values = values;
  }
}

/** `attribute > value` */
export function gt<T>(value: T): Comparison<T> {
  return new Comparison(">", [value]);
}

/** `attribute >= value`, like Rails' endless range `value..` */
export function gte<T>(value: T): Comparison<T> {
  return new Comparison(">=", [value]);
}

/** `attribute < value`, like Rails' beginless range `...value` */
export function lt<T>(value: T): Comparison<T> {
  return new Comparison("<", [value]);
}

/** `attribute <= value`, like Rails' beginless range `..value` */
export function lte<T>(value: T): Comparison<T> {
  return new Comparison("<=", [value]);
}

/**
 * `attribute BETWEEN start AND end`, both ends included, like Rails' `start..end`. With
 * `excludeEnd`, `start <= attribute < end`, like `start...end` (e.g. a window of days).
 */
export function between<T>(
  start: T,
  end: T,
  options: { excludeEnd?: boolean } = {},
): Comparison<T> {
  return new Comparison(options.excludeEnd ? "from" : "between", [start, end]);
}
