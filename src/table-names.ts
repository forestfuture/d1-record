import { InvalidModel } from "./errors.ts";
import { pluralize } from "./inflections.ts";
import type { ModelClass } from "./model.ts";
import { underscore } from "./naming.ts";

/**
 * The classes `Model({...})` makes; their `tableName` is inferred unless a subclass sets one.
 * Module-level, but not request state (ADR-0003): derived only from the classes.
 */
const bases = new WeakSet<object>();

/**
 * The name of the class that extends `base` directly, the one a table is named after, as in
 * Rails; empty when it has none (anonymous, `export default`, or `Model({...})` itself).
 */
function className(base: object, model: object): string {
  let current = model;
  while (current !== base && Object.getPrototypeOf(current) !== base) {
    current = Object.getPrototypeOf(current);
  }
  const { name } = current as { name: string };
  return current === base || name === "default" ? "" : name;
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
      const name = className(base, this);
      return name === "" ? "" : pluralize(underscore(name));
    },
    // An assignment (a static block, or a class field compiled without
    // useDefineForClassFields) names that class's table, as `static tableName = "…"` does.
    set(this: object, tableName: unknown) {
      Object.defineProperty(this, "tableName", {
        value: tableName,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    },
  });
}

/** The class name a Model's table name was inferred from, or undefined when it's declared. */
function tableNameSource(model: object): string | undefined {
  let current: object | null = model;
  while (current !== null && !Object.hasOwn(current, "tableName")) {
    current = Object.getPrototypeOf(current) as object | null;
  }
  return current !== null && bases.has(current) ? className(current, model) : undefined;
}

/** A Model must have a table name: its own, or one inferred from its class name. */
export function requireTableName(model: ModelClass): void {
  const { tableName } = model;
  if (typeof tableName === "string" && tableName !== "") return;
  throw new InvalidModel(
    tableNameSource(model) === ""
      ? `${model.name || "A Model class"} has no class name to infer its table from; set static tableName`
      : `${model.name}'s tableName must be a table's name; remove it to use the one inferred from the class name`,
  );
}

/**
 * D1's "no such table" for a table whose name was inferred, as an `InvalidModel` saying where
 * the name came from (a bundler may have renamed the class). Any other error is returned as is.
 */
export function explainMissingTable(error: unknown, models: readonly ModelClass[]): unknown {
  const message = error instanceof Error ? error.message : String(error);
  const table = /no such table: ([^\s:]+)/.exec(message)?.[1];
  const model = models.find((each) => each.tableName === table && tableNameSource(each));
  const source = model && tableNameSource(model);
  if (table === undefined || model === undefined) return error;
  return new InvalidModel(
    `${model.name}'s table "${table}" doesn't exist in D1 (inferred from the class name ` +
      `${source}; create it, set static tableName, or keep class names if your ` +
      "bundler renames them)",
    { cause: error },
  );
}
