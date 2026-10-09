import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, test } from "vite-plus/test";
import { openLocalBinding } from "../../cli/console/binding.ts";
import { runConsole } from "../../cli/console/command.ts";
import { main } from "../../cli/main.ts";
import { terminalStreams } from "../support/console.ts";
import type { TestDatabase } from "../support/d1.ts";

// Inside tests/ (gitignored): the project finds this repo's wrangler, and its tsconfig finds the
// library's source, as an app's finds its own copies.
const scratch = new URL("../.scratch/", import.meta.url).pathname;
const library = new URL("../../src/index.ts", import.meta.url).pathname;
const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A project with a users table in its local D1, a User Model, and a Wrangler config. */
async function shop(): Promise<string> {
  mkdirSync(scratch, { recursive: true });
  const cwd = mkdtempSync(join(scratch, "console-command-"));
  made.push(cwd);
  const files: Record<string, string> = {
    "wrangler.jsonc": JSON.stringify({
      d1_databases: [{ binding: "DB", database_name: "shop", database_id: "local-shop" }],
    }),
    "tsconfig.json": JSON.stringify({
      compilerOptions: { paths: { "@forestfuture/d1-record": [library] } },
    }),
    "src/models/application-record.ts": `
      import { modelFor } from "@forestfuture/d1-record";
      export const ApplicationRecord = modelFor({
        users: { attributes: { id: "integer", name: "string", email: "string" }, primaryKey: "id" },
      } as const);
    `,
    "src/models/user.ts": `
      import { ApplicationRecord } from "./application-record";
      export class User extends ApplicationRecord("users") {}
    `,
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), text);
  }
  const opened = await openLocalBinding(cwd, {
    binding: "DB",
    configFile: join(cwd, "wrangler.jsonc"),
  });
  if (typeof opened === "string") throw new Error(opened);
  const db = opened.binding as TestDatabase;
  await db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)");
  await db.exec("INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@example.com')");
  await opened.dispose();
  return cwd;
}

describe("d1-record console", () => {
  test("opens the project's local database with its Models, and persists what you do", async () => {
    const cwd = await shop();
    const terminal = terminalStreams();
    const lines: string[] = [];

    const done = runConsole({ cwd }, (line) => lines.push(line), terminal);
    await terminal.ready();

    expect(lines).toEqual(["Local database DB (.wrangler/state)", "Models: User"]);
    expect(await terminal.send("const user = await User.find(1)")).toBe("#=> undefined");
    expect(await terminal.send('await user.update({ name: "Johnny" })')).toBe("#=> true");
    expect(await terminal.send("user.name")).toBe("#=> 'Johnny'");
    terminal.input.end();
    expect(await done).toBe(0);

    const reopened = await openLocalBinding(cwd, {
      binding: "DB",
      configFile: join(cwd, "wrangler.jsonc"),
    });
    if (typeof reopened === "string") throw new Error(reopened);
    const name = await (reopened.binding as TestDatabase)
      .prepare("SELECT name FROM users WHERE id = 1")
      .first("name");
    await reopened.dispose();
    expect(name).toBe("Johnny");
  }, 90_000);

  test("says why it can't start, and exits 1", async () => {
    const cwd = mkdtempSync(join(scratch, "console-empty-"));
    made.push(cwd);
    const lines: string[] = [];

    const code = await runConsole({ cwd }, (line) => lines.push(line), terminalStreams());

    expect(code).toBe(1);
    expect(lines).toEqual([
      "No wrangler.jsonc, wrangler.json or wrangler.toml here (pass --config)",
    ]);
  });

  test("is a d1-record command with its own options in the help", async () => {
    const lines: string[] = [];

    expect(await main(["console", "--help"], (line) => lines.push(line))).toBe(0);
    expect(lines[0]).toMatch(/d1-record console +Open a console/);
    expect(lines[0]).toMatch(/--database <name>/);
  });

  test("keeps the history beside the project's local state", async () => {
    const cwd = await shop();
    const terminal = terminalStreams();
    const done = runConsole({ cwd }, () => {}, { ...terminal, terminal: true });
    const history = join(cwd, ".wrangler/d1-record-history");

    terminal.input.write("1 + 1\n");
    for (let waited = 0; !existsSync(history) && waited < 100; waited++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    terminal.input.end();
    await done;

    expect(readFileSync(history, "utf8")).toContain("1 + 1");
  }, 90_000);
});
