// A Model's table: its name (inferred, bound, or declared) and whether its queries read every column.
import { ancestors } from "./ancestors.ts";
import { InvalidModel } from "./errors.ts";
import { pluralize } from "./inflections.ts";
import type { ModelClass } from "./model.ts";
import { underscore } from "./naming.ts";

/**
 * The classes `Model.define({...})` makes; their `table` is inferred unless a subclass sets one.
 * Module-level, but not request state (ADR-0003): derived only from the classes.
 */
const bases = new WeakSet<object>();

/** A generated base class's table, and whether its overrides ignore some of its columns. */
type BoundTable = { table: string; ignoresColumns: boolean };

/**
 * What `ApplicationRecord("products", overrides)` said, by the base class it made: the table, and
 * whether the overrides ignore some of its columns (`{ notes: false }`).
 */
const boundTables = new WeakMap<object, BoundTable>();

/**
 * Each Model's answer to `ignoresColumns`, remembered since the compiler asks on every query.
 * Module-level, but not request state (ADR-0003): derived only from the class.
 */
const ignoring = new WeakMap<object, boolean>();

/**
 * The name of the class that extends `base` directly, the one a table is named after, as in
 * Rails; empty when it has none (anonymous, `export default`, or `Model.define({...})` itself).
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
 * Gives the classes extending `base` an inferred `table`, by Rails' `tableize`: the class
 * name through `underscore`, pluralized (`BlogPost` → `blog_posts`, `Person` → `people`). A
 * subclass shares its parent's; `static table = "…"` anywhere in the chain overrides it.
 */
export function inferTableNames(base: object): void {
  bases.add(base);
  Object.defineProperty(base, "table", {
    configurable: true,
    get(this: object) {
      const name = className(base, this);
      return name === "" ? "" : pluralize(underscore(name));
    },
    // An assignment (a static block, or a class field compiled without
    // useDefineForClassFields) names that class's table, as `static table = "…"` does.
    set(this: object, table: unknown) {
      Object.defineProperty(this, "table", {
        value: table,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    },
  });
}

/** The class name a Model's table name was inferred from, or undefined when it's declared. */
function tableNameSource(model: object): string | undefined {
  const owner = ancestors(model).find((each) => Object.hasOwn(each, "table"));
  return owner !== undefined && bases.has(owner) && !boundTables.has(owner)
    ? className(owner, model)
    : undefined;
}

/**
 * Binds a generated Model's base class to its table: the table isn't inferred, and a subclass
 * can't name another, since the attributes are that table's columns; and records whether its
 * overrides ignore some columns.
 */
export function bindTable(
  base: ModelClass,
  table: string,
  { ignoresColumns }: { ignoresColumns: boolean },
): void {
  base.table = table;
  boundTables.set(base, { table, ignoresColumns });
}

/** The table the nearest generated base class `model` extends (or is) is bound to, if any. */
function boundTableOf(model: object): (BoundTable & { owner: object }) | undefined {
  const owner = ancestors(model).find((each) => boundTables.has(each));
  return owner && { ...boundTables.get(owner)!, owner };
}

/**
 * Whether a Model's base class ignores some of its table's columns, so its queries name their
 * columns rather than `*` and an ignored column is never read, as in Rails. The nearest bound table
 * decides. Remembered per Model: the base class is bound before any Model extending it exists,
 * so the answer can't change.
 */
export function ignoresColumns(model: object): boolean {
  let answer = ignoring.get(model);
  if (answer === undefined) {
    answer = boundTableOf(model)?.ignoresColumns ?? false;
    ignoring.set(model, answer);
  }
  return answer;
}

/**
 * An abstract base class (the app's `ApplicationRecord`, or one marked `static abstract = true`)
 * has no table, as Rails' `abstract_class`: it's only inherited from, so using it is an
 * `InvalidModel`.
 */
export function rejectAbstract(model: ModelClass): void {
  if (ancestors(model).some((each) => bases.has(each))) return;
  const example = model.name ? `, such as class Product extends ${model.name} {}` : "";
  throw new InvalidModel(
    `${model.name || "This class"} is an abstract base class, with no table; use a Model that ` +
      `extends it${example}`,
  );
}

/** A Model must have a table name: its own, or one inferred from its class name. */
export function requireTableName(model: ModelClass): void {
  const { table } = model;
  const bound = boundTableOf(model);
  if (bound !== undefined && table !== bound.table) {
    throw new InvalidModel(
      `${model.name} sets table "${String(table)}", but its attributes are the ${bound.table} ` +
        `table's, as ${(bound.owner as { name: string }).name}'s are; a subclass shares its parent's table`,
    );
  }
  if (typeof table === "string" && table !== "") return;
  throw new InvalidModel(
    tableNameSource(model) === ""
      ? `${model.name || "A Model class"} has no class name to infer its table from; set static table`
      : `${model.name}'s table must be a table's name; remove it to use the one inferred from the class name`,
  );
}

/**
 * D1's "no such table" for a table whose name was inferred, as an `InvalidModel` saying where
 * the name came from (a bundler may have renamed the class). Any other error is returned as is.
 */
export function explainMissingTable(error: unknown, models: readonly ModelClass[]): unknown {
  const message = error instanceof Error ? error.message : String(error);
  const table = /no such table: ([^\s:]+)/.exec(message)?.[1];
  const model = models.find((each) => each.table === table && tableNameSource(each));
  const source = model && tableNameSource(model);
  if (table === undefined || model === undefined) return error;
  return new InvalidModel(
    `${model.name}'s table "${table}" doesn't exist in D1 (inferred from the class name ` +
      `${source}; create it, set static table, or keep class names if your ` +
      "bundler renames them)",
    { cause: error },
  );
}

/**
 * The class name a Model's names are inferred from, its foreign keys': the class whose table it
 * is (`Post`, for `class FeaturedPost extends Post {}`).
 */
export function modelClassName(model: object): string {
  const base = ancestors(model).find((each) => bases.has(each));
  if (base !== undefined) return className(base, model);
  return ((boundTableOf(model)?.owner ?? model) as { name: string }).name;
}
