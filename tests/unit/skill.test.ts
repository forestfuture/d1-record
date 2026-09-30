import { readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";

// SKILL.md ships in the package as plain Markdown, so its examples can't be included from files.
// They're kept as type-checked files instead (site/snippets/skill/), and must match them exactly.
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("the agent skill (SKILL.md)", () => {
  const blocks = [...read("SKILL.md").matchAll(/```ts\n([\s\S]*?)```/g)].map((match) => match[1]);

  test("its examples are the type-checked files in site/snippets/skill", () => {
    expect(blocks).toEqual([
      read("site/snippets/skill/models.ts"),
      read("site/snippets/skill/worker.ts"),
    ]);
  });

  test("its rules are a region the docs site and llms.txt read", () => {
    expect(read("SKILL.md")).toMatch(/<!-- #region rules -->[\s\S]+<!-- #endregion rules -->/);
  });
});
