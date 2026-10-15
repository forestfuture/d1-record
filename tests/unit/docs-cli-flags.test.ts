import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ParseArgsOptionsConfig } from "node:util";
import { describe, expect, test } from "vite-plus/test";
import { everySubcommand } from "../../cli/main.ts";

const page = "site/guide/command-line.md";
const guide = readFileSync(join(import.meta.dirname, "../..", page), "utf8");

/** A command's name, from its usage line: `schema`, `g` or `console`. */
function commandName(usage: string): string {
  const name = /d1-record (\w+)/.exec(usage)?.[1];
  if (name === undefined) throw new Error(`No command name in: ${usage}`);
  return name;
}

/** The flags the guide's section for a command lists, as written: `--check`, or `-e, --eval`. */
function guideFlags(name: string): string[] {
  const heading = new RegExp(`^## \`d1-record ${name}[\` ]`);
  const section = guide.split(/^(?=## )/m).find((part) => heading.test(part));
  if (section === undefined) throw new Error(`${page} has no "## \`d1-record ${name}" section`);
  return [...section.matchAll(/^\| `([^`]*)`/gm)]
    .map((match) => match[1] ?? "")
    .filter((cell) => cell.includes("--"))
    .map((cell) => /^(?:-\w, )?--[a-z][a-z-]*/.exec(cell)?.[0] ?? cell);
}

/** Each flag a command takes, written as its help writes it: `--check`, or `-e, --eval`. */
function flagsTaken(options: ParseArgsOptionsConfig): Map<string, string> {
  const written = Object.entries(options).map(([name, option]) => {
    const flag = option.short === undefined ? `--${name}` : `-${option.short}, --${name}`;
    return [name, flag] as const;
  });
  return new Map(written);
}

describe.each(
  everySubcommand.map((subcommand) => [commandName(subcommand.usage), subcommand] as const),
)(`d1-record %s: the flags in ${page}`, (name, subcommand) => {
  const taken = flagsTaken(subcommand.options);

  test("lists every flag it takes", () => {
    const listed = guideFlags(name);

    for (const [option, flag] of taken) {
      if (option !== "help") expect(listed, `${flag} has no row`).toContain(flag);
    }
  });

  test("lists only flags it takes", () => {
    const listed = guideFlags(name);

    expect(listed.length).toBeGreaterThan(0);
    for (const flag of listed) {
      expect([...taken.values()], `${flag} isn't a flag it takes`).toContain(flag);
    }
  });
});
