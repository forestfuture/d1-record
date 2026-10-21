// Error messages: the built-in English ones, a Model's own, and looking one up when it's read (#88).
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

/** Messages by attribute name, then error type. */
export interface AttributeErrorMessages {
  readonly [attribute: string]: { readonly [type: string]: ErrorMessage };
}

/**
 * A class's `errorMessages`: messages by error type (`blank`, `tooShort`, or a type of your
 * own), and under `attributes`, by attribute and type, which win over the class's others.
 */
export interface ErrorMessages {
  readonly [type: string]: ErrorMessage | RestrictMessages | AttributeErrorMessages | undefined;
  readonly attributes?: AttributeErrorMessages;
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
  /** Which of an entry's messages applies, beside the plural form: `hasOne` or `hasMany`. */
  variant?: keyof RestrictMessages;
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
function own<T>(object: { readonly [key: string]: T } | undefined, key: string): T | undefined {
  return object !== undefined && Object.hasOwn(object, key) ? object[key] : undefined;
}

/** The model, then each class it extends: where its messages and attribute names come from. */
function* lineage(model: ModelClass | undefined): Generator<ModelClass> {
  for (let each = model; each && each !== Function.prototype; each = Object.getPrototypeOf(each)) {
    yield each;
  }
}

/** The classes' own `name` statics, nearest first. */
function* ownStatics<K extends "errorMessages" | "humanAttributeNames">(
  model: ModelClass | undefined,
  name: K,
): Generator<ModelClass[K]> {
  for (const each of lineage(model)) if (Object.hasOwn(each, name)) yield each[name];
}

/** The message for a type: for the attribute, then the class's own, nearest class first (Rails' order). */
function templateFor(
  model: ModelClass | undefined,
  attribute: string,
  type: string,
): Template | undefined {
  if (type === "attributes") return undefined;
  for (const messages of [...ownStatics(model, "errorMessages"), builtIn]) {
    const found = own(own(messages.attributes, attribute), type) ?? own(messages, type);
    if (found !== undefined) return found as Template;
  }
  return undefined;
}

/** The text of a message: its variant's, or its plural form's for `count`. */
function textOf(template: Template | undefined, entry: ErrorEntry): string | undefined {
  if (template === undefined || typeof template === "string") return template;
  if ("hasOne" in template)
    return entry.variant === undefined ? undefined : template[entry.variant];
  const { count } = entry.values;
  const form = typeof count === "number" ? plurals.select(count) : "other";
  return (form === "one" ? template.one : undefined) ?? template.other;
}

/** Whether a message is found for `type` on `attribute`, here or built in. */
export function hasMessage(model: ModelClass | undefined, entry: ErrorEntry): boolean {
  return textOf(templateFor(model, entry.attribute, entry.type), entry) !== undefined;
}

/** "createdAt" → "Created at" */
function displayName(name: string): string {
  const words = underscore(name).replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** An attribute's name as messages show it: a class's `humanAttributeNames`, or "Created at". */
export function humanAttributeName(model: ModelClass | undefined, attribute: string): string {
  for (const names of ownStatics(model, "humanAttributeNames")) {
    const name = own(names, attribute);
    if (name !== undefined) return name;
  }
  return displayName(attribute);
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
  const text = textOf(templateFor(model, entry.attribute, entry.type), entry);
  if (text === undefined) throw missingMessage(model, entry);
  return text.replace(/%\{(\w+)\}/g, (placeholder, name: string) => {
    if (name === "attribute") return humanAttributeName(model, entry.attribute);
    if (name === "model") return displayName(model?.name ?? "");
    if (name === "value" && source) return shownValue(source, entry.attribute);
    return String(own(entry.values, name) ?? placeholder);
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
