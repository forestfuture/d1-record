import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";

const guide = join(import.meta.dirname, "../../site/guide");
const pages = readdirSync(guide)
  .filter((name) => name.endsWith(".md"))
  .map((name) => ({ name, text: readFileSync(join(guide, name), "utf8") }));

/** A page's prose: without front matter, fenced code, snippet includes, inline code, links' targets and HTML. */
function prose(text: string): string[] {
  const lines: string[] = [];
  let fenced = false;
  for (const line of text.replace(/^---\n[\s\S]*?\n---\n/, "").split("\n")) {
    if (line.trimStart().startsWith("```")) fenced = !fenced;
    else if (!fenced && !line.startsWith("<<<")) {
      lines.push(
        line
          .replace(/`[^`]*`/g, "")
          .replace(/\]\([^)]*\)/g, "]")
          .replace(/<[^>]*>/g, ""),
      );
    }
  }
  return lines;
}

// The guide's conventions that a tool can check (docs/agents/docs-voice.md).
describe("the guide's pages", () => {
  test("show Rails boxes in the red rails container, not an amber warning", () => {
    const amber = pages.filter(({ text }) =>
      /^::: warning (Beyond|Compared with) Rails/m.test(text),
    );

    expect(amber.map(({ name }) => name)).toEqual([]);
  });

  test("use smart quotes and apostrophes in prose", () => {
    const straight = pages.flatMap(({ name, text }) =>
      prose(text)
        .filter((line) => /["']/.test(line))
        .map((line) => `${name}: ${line.trim()}`),
    );

    expect(straight).toEqual([]);
  });
});
