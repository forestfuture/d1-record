// The published tarball holds exactly these files: the library, its `d1-record` command, its docs for
// agents, and the package's own metadata. Run with `vp run check:package`, after `vp pack` and `vp run docs:build`
// (as CI does): it packs what's built, skipping `prepack`, so pnpm prints only the JSON.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

const expected = [
  "LICENSE",
  "README.md",
  "dist/cli.mjs",
  "dist/index.d.mts",
  "dist/index.mjs",
  "llms-full.txt",
  "package.json",
  "skills/d1-record/SKILL.md",
];

execFileSync("node", [new URL("pack-docs.mjs", import.meta.url).pathname], { stdio: "inherit" });
const output = execFileSync("pnpm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
  encoding: "utf8",
});
const { files } = JSON.parse(output);
const packed = files.map((file) => file.path).sort();

if (JSON.stringify(packed) !== JSON.stringify(expected)) {
  console.error(
    `The tarball's files changed.\nExpected: ${expected.join(", ")}\nPacked:   ${packed.join(", ")}`,
  );
  process.exit(1);
}
console.log(`The tarball holds exactly: ${packed.join(", ")}`);

// An agent reads llms-full.txt as one file, away from the site, so a link to another page can't be
// relative to its page (#133). Blume writes those links from the site's root (`/models`), and each
// page opens with its `Source:` URL, which gives the host to resolve them against.
const guide = readFileSync(new URL("../llms-full.txt", import.meta.url), "utf8");
const relative = guide.match(/\]\(\.{1,2}\/[^)]*\)/g);
if (relative) {
  console.error(`llms-full.txt has ${relative.length} relative links, such as ${relative[0]}`);
  process.exit(1);
}
const pages = readdirSync(new URL("../site/docs", import.meta.url), { recursive: true }).filter(
  (name) => /\.mdx?$/.test(name) && !name.startsWith("_"),
).length;
const sources = guide.match(/^Source: https:\/\/d1-record\.forestfuture\.dev\//gm)?.length ?? 0;
if (sources !== pages) {
  console.error(`llms-full.txt names the source URL of ${sources} pages, of the guide's ${pages}`);
  process.exit(1);
}
console.log(
  `llms-full.txt names each of its ${pages} pages' source URL, and links no page relatively`,
);
