import { describe, expect, test } from "vite-plus/test";
import { absoluteLinks } from "../../site/.vitepress/llms-links.ts";

const guide = "https://docs.forestfuture.dev/d1-record/guide";

/** A page as the llms plugin writes it: front matter with its `url`, then the Markdown. */
function page(name: string, body: string): string {
  return `---\nurl: ${guide}/${name}.md\ndescription: A page.\n---\n\n${body}\n`;
}

// An agent reads llms-full.txt as one file, or a page's .md copy away from the site, so a link
// to another page has to carry the page's address (#133).
describe("absoluteLinks", () => {
  test("makes a relative link the page's Markdown URL", () => {
    const text = page("getting-started", "See [batches](./batches).");

    expect(absoluteLinks(text)).toContain(`See [batches](${guide}/batches.md).`);
  });

  test("keeps the link's fragment", () => {
    const text = page("persistence", "See [casting](./models#casting-assigned-values).");

    expect(absoluteLinks(text)).toContain(`(${guide}/models.md#casting-assigned-values)`);
  });

  test("resolves each page's links against its own url", () => {
    const text =
      page("models", "Up: [home](../).") + page("querying", "Next: [batches](./batches).");

    const rewritten = absoluteLinks(text);

    expect(rewritten).toContain("Up: [home](https://docs.forestfuture.dev/d1-record/).");
    expect(rewritten).toContain(`Next: [batches](${guide}/batches.md).`);
  });

  test("leaves absolute links, in-page anchors and fenced code alone", () => {
    const body = [
      "[D1](https://developers.cloudflare.com/d1/) and [below](#below).",
      "```md",
      "[a page](./batches)",
      "```",
    ].join("\n");
    const text = page("models", body);

    expect(absoluteLinks(text)).toBe(text);
  });
});
