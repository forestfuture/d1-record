// Checks a Model's declaration the first time it's used, then seals its declarations.
// It checks the table, the primary key, the attribute names, generated ids, and page sizes.
import { ancestors } from "./ancestors.ts";
import { declarationIn, probeOf } from "./association-fields.ts";
import { seal } from "./declarations.ts";
import { InvalidModel } from "./errors.ts";
import { generateIdProblem } from "./metadata.ts";
import { ModelBase, type ModelClass } from "./model.ts";
import { rejectAbstract, requireTableName } from "./table-names.ts";

// Module-level, but not request state (ADR-0003): it only remembers which Model
// classes have passed verifyModel(). Concurrent requests at worst verify twice.
const verified = new WeakSet<object>();

/** Checks a Model's declaration the first time it's used; throws `InvalidModel`. */
export function verifyModel(model: ModelClass): void {
  if (verified.has(model)) return;
  rejectAbstract(model);
  requireTableName(model);
  requirePrimaryKeyAttribute(model);
  rejectReservedAttributeNames(model);
  rejectBadGeneratedIds(model);
  rejectShadowingFields(model);
  rejectBadPageSizes(model);
  // The classes it inherits declarations from too (an app's Base), so none can change later.
  for (const each of ancestors(model)) {
    if (each === ModelBase) break;
    seal(each);
  }
  verified.add(model);
}

function requirePrimaryKeyAttribute(model: ModelClass): void {
  if (!model.attributeDefinitions.has(model.primaryKey)) {
    throw new InvalidModel(
      `${model.name}'s primaryKey "${model.primaryKey}" isn't a declared attribute; ` +
        "declare it in Model({...}) or set `static primaryKey`",
    );
  }
}

function rejectReservedAttributeNames(model: ModelClass): void {
  for (const name of model.attributeDefinitions.keys()) {
    if (name in ModelBase.prototype) {
      throw new InvalidModel(
        `${model.name} declares an attribute "${name}", which is the name of a record method or property; ` +
          "rename the attribute and map it with { column }",
      );
    }
  }
}

/** A generated id is a string, and comes from `generateId` alone, not a default as well. */
function rejectBadGeneratedIds(model: ModelClass): void {
  for (const [name, definition] of model.attributeDefinitions) {
    const problem = generateIdProblem(`${model.name}.${name}`, definition);
    if (problem !== undefined) throw new InvalidModel(problem);
  }
}

/** `perPage` and `maxPerPage` are page sizes: whole numbers from 1, so the cap always holds. */
function rejectBadPageSizes(model: ModelClass): void {
  for (const name of ["perPage", "maxPerPage"] as const) {
    const size = model[name];
    if (!Number.isSafeInteger(size) || size < 1) {
      throw new InvalidModel(
        `${model.name}'s ${name} is ${String(size)}; set it to a whole number from 1`,
      );
    }
  }
}

function rejectShadowingFields(model: ModelClass): void {
  const probe = probeOf(model) as unknown as Record<string, unknown>;
  for (const name of model.attributeDefinitions.keys()) {
    // An association field with an attribute's name is reported when associations are checked.
    if (Object.hasOwn(probe, name) && declarationIn(probe[name]) === undefined) {
      throw new InvalidModel(
        `${model.name} declares a class field "${name}" that hides the attribute's accessor; ` +
          "remove it (attributes are declared in Model({...}))",
      );
    }
  }
}
