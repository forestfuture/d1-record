const relativeLink = /\]\((\.{1,2}\/[^)\s]*)\)/g;

/** A relative link's target as the page's absolute Markdown URL: `./models#x` → `…/guide/models.md#x`. */
function absoluteTarget(href: string, page: string): string {
  const url = new URL(href, page);
  if (!url.pathname.endsWith("/") && !/\.[a-z]+$/.test(url.pathname)) url.pathname += ".md";
  return url.href;
}

/**
 * Makes every relative link to another page absolute, resolved against the page it's in: the
 * `url:` in its front matter, so it holds in llms-full.txt (many pages in one file) and in a page's
 * Markdown copy read away from the site. Fenced code and other links are left as they are (#133).
 */
export function absoluteLinks(markdown: string): string {
  let page: string | undefined;
  let fenced = false;
  let previous = "";
  return markdown
    .split("\n")
    .map((line) => {
      const opensPage = previous === "---" && !fenced ? /^url: (\S+)$/.exec(line)?.[1] : undefined;
      previous = line;
      if (line.trimStart().startsWith("```")) fenced = !fenced;
      if (opensPage !== undefined) page = opensPage;
      if (fenced || page === undefined || opensPage !== undefined) return line;
      return line.replace(relativeLink, (_, href: string) => `](${absoluteTarget(href, page!)})`);
    })
    .join("\n");
}
