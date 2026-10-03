import { camelize } from "../../src/naming.ts";

/** Whether a name can be written bare: as a `const`, or as an object key without quotes. */
export function isIdentifier(name: string): boolean {
  return /^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(name);
}

/** A column's attribute: camelCase, keeping any leading underscores (`_secret` stays). */
export function attributeName(column: string): string {
  const lead = /^_*/.exec(column)![0];
  return lead + camelize(column.slice(lead.length));
}

/** Words JavaScript doesn't allow as a `const` name, and the generated file's own names. */
const reserved = new Set(
  (
    "break case catch class const continue debugger default delete do else enum export extends " +
    "false finally for function if import in instanceof new null return super switch this throw " +
    "true try typeof var void while with yield let static implements interface package private " +
    "protected public await arguments eval tables Model modelFor"
  ).split(" "),
);

/**
 * The `const` a table is exported as: its words in camelCase (`line_items` → `lineItems`),
 * never a reserved word (`default` → `defaultTable`) or starting with a digit (`2fa` →
 * `table2fa`).
 */
export function exportName(table: string): string {
  const words = table.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const name = words
    .map((word, index) => (index === 0 ? word : word[0]!.toUpperCase() + word.slice(1)))
    .join("");
  if (name === "" || /^\p{N}/u.test(name)) return `table${name}`;
  return reserved.has(name) ? `${name}Table` : name;
}
