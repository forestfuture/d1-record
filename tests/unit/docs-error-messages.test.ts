import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { builtInMessages, type RestrictMessages } from "../../src/error-messages.ts";

const page = "site/guide/validations.md";
const validationsPage = readFileSync(join(import.meta.dirname, "../..", page), "utf8");

/** Each `type: message` the guide's built-in messages table lists, with straight apostrophes. */
function guideRows(): string[] {
  const section = validationsPage
    .split(/^(?=### )/m)
    .find((part) => part.startsWith("### Finding a built-in message"));
  return [...(section ?? "").matchAll(/^\| `(\w+)` +\|[^|]*\| (.+?) +\|$/gm)].map(
    (match) => `${match[1]}: ${(match[2] ?? "").replaceAll("’", "'")}`,
  );
}

/** Each `type: message` of the built-in dictionary, with a plural message's form for any count. */
function builtInRows(): string[] {
  return Object.entries(builtInMessages).flatMap(([type, message]) => {
    if (typeof message === "string") return [`${type}: ${message}`];
    if (message !== undefined && "hasOne" in message) {
      const { hasOne, hasMany } = message as RestrictMessages;
      return [`${type}: ${hasOne}`, `${type}: ${hasMany}`];
    }
    return [`${type}: ${String((message as { other: string }).other)}`];
  });
}

describe(`the built-in messages in ${page}`, () => {
  test("are the library's, one row each, in any order", () => {
    expect(guideRows().toSorted()).toEqual(builtInRows().toSorted());
  });
});
