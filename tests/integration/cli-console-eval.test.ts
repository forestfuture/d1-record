import { existsSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, onTestFinished, test, vi } from "vite-plus/test";
import { runConsole } from "../../cli/console/command.ts";
import { main } from "../../cli/main.ts";
import { scratchDirs } from "../support/scratch.ts";
import { shop } from "../support/shop.ts";

const scratch = scratchDirs();

/** What `console -e` printed on each stream, and its exit code. */
async function evaluating(code: string, options: { verbose?: boolean; cwd?: string } = {}) {
  const cwd = options.cwd ?? (await shop(scratch));
  const input = new PassThrough();
  const output = new PassThrough();
  const error = new PassThrough();
  const said: string[] = [];
  let stdout = "";
  let stderr = "";
  output.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
  error.on("data", (chunk: Buffer) => (stderr += chunk.toString()));

  const exitCode = await runConsole(
    { cwd, eval: code, verbose: options.verbose },
    (line) => said.push(line),
    { input, output, error },
  );
  return { cwd, exitCode, stdout, stderr, said };
}

// `d1-record console -e` (#105): one piece of code, its result on stdout, everything else on stderr.
describe("d1-record console -e", () => {
  test("prints the result on stdout, and nothing else there", async () => {
    const run = await evaluating("(await User.find(1)).name");

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe("Alice\n");
    expect(run.said).toEqual([]);
  }, 90_000);

  test("says which database and Models it opened on stderr", async () => {
    const run = await evaluating("1 + 1");

    expect(run.stderr).toBe("Local database DB (.wrangler/state)\nModels: User\n");
  }, 90_000);

  test("a failure prints its stack on stderr, nothing on stdout, and exits 1", async () => {
    const run = await evaluating("await User.find(99)");

    expect(run.exitCode).toBe(1);
    expect(run.stdout).toBe("");
    expect(run.stderr).toMatch(/RecordNotFound/);
  }, 90_000);

  test("its writes persist, since it is the same database the console opens", async () => {
    const first = await evaluating(
      'await User.create({ id: 2, name: "Bob", email: "b@example.com" })',
    );
    const second = await evaluating("await User.count()", { cwd: first.cwd });

    expect(first.exitCode).toBe(0);
    expect(second.stdout).toBe("2\n");
  }, 120_000);

  test("prints each statement's SQL on stderr with --verbose, not on stdout", async () => {
    const run = await evaluating("(await User.find(1)).name", { verbose: true });

    expect(run.stdout).toBe("Alice\n");
    expect(run.stderr).toMatch(/User +\d+(\.\d+)?ms +SELECT /);
  }, 90_000);

  test("says why it can't start on stderr, and exits 1", async () => {
    const run = await evaluating("1 + 1", { cwd: scratch("console-eval-empty-") });

    expect(run.exitCode).toBe(1);
    expect(run.stdout).toBe("");
    expect(run.stderr).toBe(
      "No wrangler.jsonc, wrangler.json or wrangler.toml here (pass --config)\n",
    );
  });

  test("keeps no history", async () => {
    const run = await evaluating("1 + 1");

    expect(existsSync(join(run.cwd, ".wrangler/d1-record-history"))).toBe(false);
  }, 90_000);
});

describe("-e on the command line", () => {
  test("is a d1-record console option, in the help", async () => {
    const lines: string[] = [];

    await main(["console", "--help"], (line) => lines.push(line));

    expect(lines[0]).toMatch(/-e, --eval <code> +Run this code/);
  });

  test("runs the code, and prints the result", async () => {
    const cwd = await shop(scratch);
    const inProject = vi.spyOn(process, "cwd").mockReturnValue(cwd);
    const written: string[] = [];
    const out = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    onTestFinished(() => {
      inProject.mockRestore();
      out.mockRestore();
    });

    const code = await main(["console", "-e", "(await User.find(1)).email"], () => {});
    out.mockRestore();

    expect(code).toBe(0);
    expect(written.join("")).toBe("alice@example.com\n");
  }, 90_000);

  test("takes --eval as well", async () => {
    const cwd = await shop(scratch);
    const inProject = vi.spyOn(process, "cwd").mockReturnValue(cwd);
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    onTestFinished(() => {
      inProject.mockRestore();
      out.mockRestore();
    });

    expect(await main(["console", "--eval", "1 + 1"], () => {})).toBe(0);
  }, 90_000);

  test("once only: join statements with a semicolon", async () => {
    const lines: string[] = [];

    expect(await main(["console", "-e", "1", "-e", "2"], (line) => lines.push(line))).toBe(1);
    expect(lines[0]).toMatch(/^Use -e once; join statements with ;/);
  });

  test("needs some code", async () => {
    const lines: string[] = [];

    expect(await main(["console", "-e", ""], (line) => lines.push(line))).toBe(1);
    expect(lines[0]).toMatch(/^-e needs some code/);
  });
});
