// A Model's table: its name (inferred, bound, or declared) and whether it reads every column.
import { ancestors } from "./ancestors.ts";
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
 * What `ApplicationRecord("products", overrides)` said, by the base class it made: the table, and
 * whether the overrides ignore some of its columns (`{ notes: false }`).
 */
const boundTables = new WeakMap<object, { table: string; ignoresColumns: boolean }>();

/**
 * Each Model's answer to `ignoresColumns`, remembered since the compiler asks on every query.
 * Module-level, but not request state (ADR-0003): derived only from the class.
 */
const ignoring = new WeakMap<object, boolean>();

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
  const owner = ancestors(model).find((each) => Object.hasOwn(each, "tableName"));
  return owner !== undefined && bases.has(owner) && !boundTables.has(owner)
    ? className(owner, model)
    : undefined;
}

/**
 * Binds a generated Model's base class to its table: the table isn't inferred, and a subclass
 * can't name another, since the attributes are that table's columns.
 */
export function bindTable(
  base: ModelClass,
  table: string,
  { ignoresColumns }: { ignoresColumns: boolean },
): void {
  base.tableName = table;
  boundTables.set(base, { table, ignoresColumns });
}

/** What the generated base class `model` extends (or is) was bound with, if it has one. */
function bindingOf(model: object): { table: string; ignoresColumns: boolean } | undefined {
  const owner = ancestors(model).find((each) => boundTables.has(each));
  return owner && boundTables.get(owner);
}

/** The table a generated Model's base class is bound to, if `model` has one. */
function boundTableOf(model: object): string | undefined {
  return bindingOf(model)?.table;
}

/**
 * Whether a Model's base class ignores some of its table's columns, so its queries name their
 * columns rather than `*` and an ignored column is never read, as in Rails. Remembered per Model:
 * the base class is bound before any Model extending it exists, so the answer can't change.
 */
export function ignoresColumns(model: object): boolean {
  let answer = ignoring.get(model);
  if (answer === undefined) {
    answer = bindingOf(model)?.ignoresColumns ?? false;
    ignoring.set(model, answer);
  }
  return answer;
}

/**
 * An abstract base class (one extending `Model.Base` directly, like `ApplicationRecord`'s) has no
 * table, as Rails' `abstract_class`: it's only inherited from, so using it is an `InvalidModel`.
 */
export function rejectAbstract(model: ModelClass): void {
  if (ancestors(model).some((each) => bases.has(each))) return;
  throw new InvalidModel(
    `${model.name || "This class"} is an abstract base class, with no table; use a Model built on it, ` +
      'such as class Product extends ApplicationRecord("products") {}',
  );
}

/** A Model must have a table name: its own, or one inferred from its class name. */
export function requireTableName(model: ModelClass): void {
  const { tableName } = model;
  const bound = boundTableOf(model);
  if (bound !== undefined && tableName !== bound) {
    throw new InvalidModel(
      `${model.name} sets tableName "${String(tableName)}", but its attributes are the ${bound} ` +
        "table's; name the table in its base class's call instead (ApplicationRecord(\"…\"))",
    );
  }
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

/** The class name a Model's names are inferred from: its table's and its foreign keys'. */
export function modelClassName(model: object): string {
  const base = ancestors(model).find((each) => bases.has(each));
  return base === undefined ? (model as { name: string }).name : className(base, model);
}
