// Error messages: the built-in English ones, a Model's own, and looking one up when it's read (#88).
import { declared, type Declarations } from "./declarations.ts";
import { InvalidModel } from "./errors.ts";
import type { ModelClass } from "./model.ts";
import { FILTERED, isFiltered } from "./filtering.ts";
import { underscore } from "./naming.ts";

/**
 * An error's message, after the attribute's name: `"can't be blank"`. With a count, one for
 * each plural form: `{ one: "needs 1 character", other: "needs %{count} characters" }`.
 */
export type ErrorMessage = string | { readonly one?: string; readonly other: string };

/** The messages of `restrictDependentDestroy`, for a has-one and a has-many association. */
export interface RestrictMessages {
  readonly hasOne: string;
  readonly hasMany: string;
}

/** Messages by attribute name (`N`: the names a Model has), then error type. */
export type AttributeErrorMessages<N extends string = string> = {
  readonly [K in N]?: { readonly [type: string]: ErrorMessage };
};

/**
 * What `errorMessages` declares: messages by error type (`blank`, `tooShort`, or a type of your
 * own), and under `attributes`, by attribute and type, which win over the class's others.
 */
export interface ErrorMessages<N extends string = string> {
  readonly [type: string]: ErrorMessage | RestrictMessages | AttributeErrorMessages<N> | undefined;
  readonly attributes?: AttributeErrorMessages<N>;
  readonly restrictDependentDestroy?: RestrictMessages;
}

/** Rails' English messages, used where no class has its own. */
const builtIn: ErrorMessages = {
  blank: "can't be blank",
  invalid: "is invalid",
  inclusion: "is not included in the list",
  taken: "has already been taken",
  tooShort: {
    one: "is too short (minimum is 1 character)",
    other: "is too short (minimum is %{count} characters)",
  },
  tooLong: {
    one: "is too long (maximum is 1 character)",
    other: "is too long (maximum is %{count} characters)",
  },
  wrongLength: {
    one: "is the wrong length (should be 1 character)",
    other: "is the wrong length (should be %{count} characters)",
  },
  notANumber: "is not a number",
  notAnInteger: "must be an integer",
  greaterThan: "must be greater than %{count}",
  greaterThanOrEqualTo: "must be greater than or equal to %{count}",
  lessThan: "must be less than %{count}",
  lessThanOrEqualTo: "must be less than or equal to %{count}",
  restrictDependentDestroy: {
    hasOne: "Cannot delete record because a dependent %{record} exists",
    hasMany: "Cannot delete record because dependent %{record} exist",
  },
};

/** The values an error's message can show as `%{name}`, such as `count`. */
export type ErrorValues = Readonly<Record<string, string | number>>;

/** One error, as `Errors` keeps it: its message is looked up when it's read, unless it's given. */
export interface ErrorEntry {
  attribute: string;
  type: string;
  values: ErrorValues;
  /** A message given as text, used as it is. */
  message?: string;
  /** The kind of association that refused, choosing between `restrictDependentDestroy`'s messages. */
  associationKind?: keyof RestrictMessages;
}

/** Where an error's message comes from: the record's Model, and its values for `%{value}`. */
export interface MessageSource {
  model: ModelClass;
  read: (attribute: string) => unknown;
}

/** A message as a class declares it, for one type. */
type Template = ErrorMessage | RestrictMessages;

const plurals = new Intl.PluralRules("en");

/** `object[key]` when it's the object's own, so `toString` is never a message. */
function ownValue<T>(
  object: { readonly [key: string]: T } | undefined,
  key: string,
): T | undefined {
  return object !== undefined && Object.hasOwn(object, key) ? object[key] : undefined;
}

/** A model's declarations of `kind`, a class's together, nearest class first. */
function declarationsByClass<K extends "errorMessages" | "humanAttributeNames">(
  model: ModelClass | undefined,
  kind: K,
): Declarations[K]["value"][][] {
  const groups: { from: object; values: Declarations[K]["value"][] }[] = [];
  for (const { from, value } of model ? declared(model, kind) : []) {
    const last = groups.at(-1);
    if (last?.from === from) last.values.push(value);
    else groups.push({ from, values: [value] });
  }
  return groups.reverse().map((group) => group.values);
}

/** One class's `errorMessages` calls as one: a later call's message wins, type by type. */
function mergedCalls(calls: readonly ErrorMessages[]): ErrorMessages {
  const attributes: Record<string, Record<string, ErrorMessage>> = {};
  for (const call of calls) {
    for (const [name, types] of Object.entries(call.attributes ?? {})) {
      attributes[name] = { ...attributes[name], ...types };
    }
  }
  return Object.assign({}, ...calls, { attributes }) as ErrorMessages;
}

/** The message for a type: for the attribute, then the class's own, nearest class first (Rails' order). */
function templateFor(
  model: ModelClass | undefined,
  attribute: string,
  type: string,
): Template | undefined {
  if (type === "attributes") return undefined;
  for (const messages of [
    ...declarationsByClass(model, "errorMessages").map(mergedCalls),
    builtIn,
  ]) {
    const found =
      ownValue(ownValue(messages.attributes, attribute), type) ?? ownValue(messages, type);
    if (found !== undefined) return found as Template;
  }
  return undefined;
}

/** The text of a message: the one for its association's kind, or its plural form's for `count`. */
function messageText(template: Template | undefined, entry: ErrorEntry): string | undefined {
  if (template === undefined || typeof template === "string") return template;
  if ("hasOne" in template)
    return entry.associationKind === undefined ? undefined : template[entry.associationKind];
  const { count } = entry.values;
  const form = typeof count === "number" ? plurals.select(count) : "other";
  return (form === "one" ? template.one : undefined) ?? template.other;
}

/** Whether a message is found for `type` on `attribute`, here or built in. */
export function hasMessage(model: ModelClass | undefined, entry: ErrorEntry): boolean {
  return messageText(templateFor(model, entry.attribute, entry.type), entry) !== undefined;
}

/** "createdAt" → "Created at" */
function inWords(name: string): string {
  const words = underscore(name).replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** An attribute's name as messages show it: a class's `humanAttributeNames`, or "Created at". */
export function humanAttributeName(model: ModelClass | undefined, attribute: string): string {
  for (const calls of declarationsByClass(model, "humanAttributeNames")) {
    const name = calls.findLast((names) => ownValue(names, attribute) !== undefined)?.[attribute];
    if (name !== undefined) return name;
  }
  return inWords(attribute);
}

/** An attribute's value as `%{value}` shows it. */
function shownValue(source: MessageSource, attribute: string): string {
  if (attribute === "base") return "";
  const value = source.read(attribute);
  if (value === null || value === undefined) return "";
  if (isFiltered(source.model, attribute)) return FILTERED;
  if (value instanceof Date) return value.toISOString();
  return typeof value === "object" ? JSON.stringify(value) : String(value as string | number);
}

/** An entry's message: given, or looked up now, with its `%{name}` placeholders filled in. */
export function messageOf(source: MessageSource | undefined, entry: ErrorEntry): string {
  if (entry.message !== undefined) return entry.message;
  const model = source?.model;
  const text = messageText(templateFor(model, entry.attribute, entry.type), entry);
  if (text === undefined) throw missingMessage(model, entry);
  return text.replace(/%\{(\w+)\}/g, (placeholder, name: string) => {
    if (name === "attribute") return humanAttributeName(model, entry.attribute);
    if (name === "model") return inWords(model?.name ?? "");
    if (name === "value" && source) return shownValue(source, entry.attribute);
    return String(ownValue(entry.values, name) ?? placeholder);
  });
}

/** The error for a type no class has a message for. */
export function missingMessage(model: ModelClass | undefined, entry: ErrorEntry): TypeError {
  const where = model ? `${model.name}'s errorMessages, or a class it extends` : "errorMessages";
  return new TypeError(
    `No message for the error "${entry.type}" on "${entry.attribute}": add one to ${where}, ` +
      `as ${entry.type} or attributes.${entry.attribute}.${entry.type}`,
  );
}

/** The names each declaration names an attribute by, with the class it was made on. */
function namesIn(model: ModelClass): { from: object; where: string; names: string[] }[] {
  return [
    ...declared(model, "errorMessages").map(({ from, value }) => ({
      from,
      where: "errorMessages has messages for",
      names: Object.keys(value.attributes ?? {}),
    })),
    ...declared(model, "humanAttributeNames").map(({ from, value }) => ({
      from,
      where: "humanAttributeNames names",
      names: Object.keys(value),
    })),
  ];
}

/**
 * A Model's messages and attribute names must be for its attributes, its associations or
 * `"base"`, so a typo isn't left unused. Those of a class without attributes (the app's base
 * class) are the exception: they apply to the Models that have them.
 */
export function rejectUnknownMessageNames(model: ModelClass, associations: Iterable<string>): void {
  const known = new Set(["base", ...model.attributeDefinitions.keys(), ...associations]);
  for (const { from, where, names } of namesIn(model)) {
    if ((from as ModelClass).attributeDefinitions.size === 0) continue;
    const unknown = names.find((name) => !known.has(name));
    if (unknown === undefined) continue;
    throw new InvalidModel(
      `${(from as ModelClass).name}'s ${where} "${unknown}", which isn't one of its ` +
        "attributes or associations; name them exactly",
    );
  }
}
