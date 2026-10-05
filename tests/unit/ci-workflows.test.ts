import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";

const github = new URL("../../.github/", import.meta.url).pathname;

/** Every workflow and composite action file under `.github/`. */
function workflowFiles(): string[] {
  return readdirSync(github, { recursive: true, encoding: "utf8" })
    .filter((path) => /\.ya?ml$/.test(path) && !path.startsWith("ISSUE_TEMPLATE"))
    .map((path) => join(github, path));
}

/** `uses:` references to other repositories' actions (a local `./` action is ours). */
function thirdPartyActions(file: string): string[] {
  return [...readFileSync(file, "utf8").matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)]
    .map(([, reference]) => reference!)
    .filter((reference) => !reference.startsWith("./"));
}

// A tag can be moved to other code; a commit SHA can't (#80). Dependabot keeps the pins current.
describe("CI's third-party actions", () => {
  test("are pinned to a full commit SHA", () => {
    const unpinned = workflowFiles().flatMap((file) =>
      thirdPartyActions(file)
        .filter((reference) => !/@[0-9a-f]{40}$/.test(reference))
        .map((reference) => `${file.slice(github.length)}: ${reference}`),
    );

    expect(unpinned).toEqual([]);
  });

  test("are found in every workflow", () => {
    expect(workflowFiles().flatMap(thirdPartyActions).length).toBeGreaterThan(0);
  });
});

/** Each job in a workflow file, as its name and its text (jobs are the two-space-indented keys). */
function jobsOf(file: string): [string, string][] {
  const text = readFileSync(file, "utf8");
  const body = text.slice(text.indexOf("\njobs:\n"));
  return body
    .split(/^(?=  [\w-]+:\s*$)/m)
    .slice(1)
    .map((job) => [job.trim().split(":")[0]!, job]);
}

describe("CI jobs that can write to the repository or publish", () => {
  test("install dependencies without their install scripts or the shared cache", () => {
    const writing = workflowFiles()
      .filter((file) => file.includes("/workflows/"))
      .flatMap(jobsOf)
      .filter(([, job]) => /^\s+(?:contents|id-token|pull-requests): write/m.test(job));

    expect(writing.map(([name]) => name)).toEqual(["release-version", "release-publish"]);
    for (const [name, job] of writing) {
      expect(job, name).toMatch(/holds-write-token: true/);
    }
  });
});
