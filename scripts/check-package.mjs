// The published tarball holds exactly these files: the library, its docs for agents, and the
// package's own metadata. Run with `vp run check:package` (packing builds everything first).
import { execFileSync } from "node:child_process";

const expected = [
  "LICENSE",
  "README.md",
  "SKILL.md",
  "dist/index.d.mts",
  "dist/index.mjs",
  "llms-full.txt",
  "package.json",
];

const output = execFileSync("pnpm", ["pack", "--dry-run", "--json"], { encoding: "utf8" });
const { files } = JSON.parse(output.slice(output.indexOf("{")));
const packed = files.map((file) => file.path).sort();

if (JSON.stringify(packed) !== JSON.stringify(expected)) {
  console.error(
    `The tarball's files changed.\nExpected: ${expected.join(", ")}\nPacked:   ${packed.join(", ")}`,
  );
  process.exit(1);
}
console.log(`The tarball holds exactly: ${packed.join(", ")}`);
