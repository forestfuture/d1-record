import { InvalidModel } from "./errors.ts";
import { pluralize } from "./inflections.ts";
import type { ModelClass } from "./model.ts";
import { underscore } from "./naming.ts";

/** The classes `Model({...})` makes; their `tableName` is inferred unless a subclass sets one. */
const bases = new WeakSet<object>();

/** The class that extends `base` directly: the one a table is named after, as in Rails. */
function namedClass(base: object, model: object): { name: string } {
  let current = model;
  while (Object.getPrototypeOf(current) !== base && current !== base) {
    current = Object.getPrototypeOf(current);
  }
  return current as { name: string };
}

/**
 * Gives the classes extending `base` an inferred `tableName`, by Rails' `tableize`: the class
 * name through `underscore`, pluralized (`BlogPost` → `blog_posts`, `Person` → `people`). A
 * subclass shares its parent's; `static tableName = "…"` anywhere in the chain overrides it.
 */
export function inferTableNames(base: object): void {
  bases.add(base);
  Object.defineProperty(base, "tableName", {
    configurable: true,
    get(this: object) {
      return pluralize(underscore(namedClass(base, this).name));
    },
  });
}

/** The class name a Model's table name was inferred from, or undefined when it's declared. */
function tableNameSource(model: object): string | undefined {
  let current: object | null = model;
  while (current !== null && !Object.hasOwn(current, "tableName")) {
    current = Object.getPrototypeOf(current) as object | null;
  }
  return current !== null && bases.has(current) ? namedClass(current, model).name : undefined;
}

/**
 * D1's "no such table" for a table whose name was inferred, as an `InvalidModel` saying where
 * the name came from (a bundler may have renamed the class). Any other error is returned as is.
 */
export function explainMissingTable(error: unknown, models: readonly ModelClass[]): unknown {
  const message = error instanceof Error ? error.message : String(error);
  const table = /no such table: ([^\s:]+)/.exec(message)?.[1];
  const model = models.find((each) => each.tableName === table && tableNameSource(each));
  if (table === undefined || model === undefined) return error;
  return new InvalidModel(
    `${model.name}'s table "${table}" doesn't exist in D1 (inferred from the class name ` +
      `${tableNameSource(model)}; create it, set static tableName, or keep class names if your ` +
      "bundler renames them)",
    { cause: error },
  );
}
