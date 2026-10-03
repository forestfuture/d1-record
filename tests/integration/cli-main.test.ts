import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { main } from "../../cli/main.ts";

describe("the d1-record command line", () => {
  test("schema runs with its options, and --help explains them", () => {
    const cwd = mkdtempSync(join(tmpdir(), "d1-record-main-"));
    mkdirSync(join(cwd, "migrations"));
    writeFileSync(join(cwd, "wrangler.jsonc"), '{ "d1_databases": [{ "binding": "DB" }] }');
    writeFileSync(join(cwd, "migrations/0001.sql"), "CREATE TABLE users (id INTEGER PRIMARY KEY);");
    const output: string[] = [];

    const help = main(["--help"], (line) => output.push(line));
    const generated = main(
      ["schema", "--config", join(cwd, "wrangler.jsonc"), "--out", join(cwd, "out.ts")],
      (line) => output.push(line),
    );

    expect(help).toBe(0);
    expect(output[0]).toMatch(/^Usage: d1-record schema \[options\]/);
    expect(generated).toBe(0);
    expect(output[1]).toMatch(/^Wrote .*out\.ts \(1 table\)/);
  });

  test("anything else prints the usage and fails", () => {
    const output: string[] = [];

    expect(main(["migrate"], (line) => output.push(line))).toBe(1);
    expect(output[0]).toMatch(/^Usage:/);
  });
});
