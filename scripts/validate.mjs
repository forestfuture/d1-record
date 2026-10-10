// The checks CI runs, in CI's order, with one line per step: the failing step's output follows it.
// Run with `vp run validate` before asking to push (docs/agents/workflow.md, step 5).
import { spawnSync } from "node:child_process";

const steps = [
  { name: "check", args: ["check"] },
  { name: "test", args: ["test"] },
  { name: "pack", args: ["pack"] },
  { name: "public types", args: ["run", "check:public-types"] },
  { name: "knip", args: ["run", "knip"] },
  { name: "docs build", args: ["run", "docs:build"] },
  { name: "package contents", args: ["run", "check:package"] },
];

for (const { name, args } of steps) {
  const started = Date.now();
  const run = spawnSync("vp", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (run.status === 0) {
    console.log(`pass  ${name} (${seconds}s)`);
    continue;
  }
  console.log(`FAIL  ${name} (${seconds}s), \`vp ${args.join(" ")}\`:`);
  const output = `${run.stdout}${run.stderr}`.trimEnd().split("\n");
  console.log(output.slice(-80).join("\n"));
  process.exit(run.status ?? 1);
}
console.log("All steps passed.");
