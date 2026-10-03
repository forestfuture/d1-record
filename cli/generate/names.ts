import { pluralize, singularize } from "../../src/inflections.ts";
import { camelize, underscore } from "../../src/naming.ts";

/** A name the generators accept: letters, digits and `_`, starting with a letter. */
const allowed = /^[A-Za-z][A-Za-z0-9_]*$/;

/** A class name from any spelling: `line_item`, `lineItem` → `LineItem`. */
export function classify(name: string): string {
  const camel = camelize(underscore(name));
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

/** A Model's table, as Rails' `tableize` names it: `LineItem` → `line_items`. */
export function tableize(className: string): string {
  return pluralize(underscore(className));
}

/** A Model's module, in kebab-case: `LineItem` → `line-item` (its file is `line-item.ts`). */
export function moduleName(className: string): string {
  return underscore(className).replaceAll("_", "-");
}

/**
 * The class a `g model` name asks for, singular as Rails makes it (`line_items` → `LineItem`),
 * with a note when it was plural; or why the name won't do.
 */
export function modelName(
  given: string,
): { ok: true; className: string; note?: string } | { ok: false; error: string } {
  if (!allowed.test(given)) {
    return {
      ok: false,
      error: `${given} isn't a Model name; use letters and digits, like LineItem`,
    };
  }
  const className = classify(singularize(underscore(given)));
  return className === classify(given)
    ? { ok: true, className }
    : {
        ok: true,
        className,
        note: `${given} looks plural, so the Model is ${className}, as Rails names it`,
      };
}

/** Whether a migration's name is usable as its file's name, or why not. */
export function migrationNameError(given: string): string | undefined {
  return allowed.test(given)
    ? undefined
    : `${given} isn't a migration name; use letters, digits and _, like AddSkuToProducts`;
}
