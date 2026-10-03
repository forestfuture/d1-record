// The published tarball holds exactly these files: the library, its `d1-record` command, its docs for
// agents, and the package's own metadata. Run with `vp run check:package`, after `vp pack` and `vp run docs:build`
// (as CI does): it packs what's built, skipping `prepack`, so pnpm prints only the JSON.
import { execFileSync } from "node:child_process";

const expected = [
  "LICENSE",
  "README.md",
  "SKILL.md",
  "dist/cli.mjs",
  "dist/index.d.mts",
  "dist/index.mjs",
  "llms-full.txt",
  "package.json",
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
