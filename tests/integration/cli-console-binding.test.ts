import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vite-plus/test";
import { openLocalBinding } from "../../cli/console/binding.ts";
import type { TestDatabase } from "../support/d1.ts";

// Inside tests/ (gitignored), so the project finds this repo's wrangler, as an app finds its own.
const scratch = new URL("../.scratch/", import.meta.url).pathname;
const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function project(binding: object): string {
  mkdirSync(scratch, { recursive: true });
  const dir = mkdtempSync(join(scratch, "console-binding-"));
  made.push(dir);
  writeFileSync(join(dir, "wrangler.jsonc"), JSON.stringify({ d1_databases: [binding] }));
  return dir;
}

describe("the console's local database binding", () => {
  test("is the project's local D1, kept in .wrangler/state between sessions", async () => {
    const cwd = project({ binding: "DB", database_name: "shop", database_id: "local-shop" });
    const configFile = join(cwd, "wrangler.jsonc");

    const first = await openLocalBinding(cwd, { binding: "DB", configFile });
    if (typeof first === "string") throw new Error(first);
    const db = first.binding as TestDatabase;
    await db.exec("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)");
    await db.prepare("INSERT INTO notes (id, body) VALUES (1, 'kept')").run();
    await first.dispose();

    const second = await openLocalBinding(cwd, { binding: "DB", configFile });
    if (typeof second === "string") throw new Error(second);
    const kept = await (second.binding as TestDatabase)
      .prepare("SELECT body FROM notes WHERE id = 1")
      .first("body");
    await second.dispose();

    expect(kept).toBe("kept");
    // Beside the config, where wrangler dev keeps it, not wherever the command runs from.
    expect(existsSync(join(cwd, ".wrangler/state/v3/d1"))).toBe(true);
    expect(existsSync(join(process.cwd(), ".wrangler"))).toBe(false);
    expect(first.description).toBe("Local database DB (.wrangler/state)");
  }, 60_000);

  test("stays local when the config marks the binding remote", async () => {
    const cwd = project({
      binding: "DB",
      database_name: "shop",
      database_id: "0000-remote",
      remote: true,
    });

    const opened = await openLocalBinding(cwd, {
      binding: "DB",
      configFile: join(cwd, "wrangler.jsonc"),
    });
    if (typeof opened === "string") throw new Error(opened);
    const one = await (opened.binding as TestDatabase).prepare("SELECT 1 AS one").first("one");
    await opened.dispose();

    expect(one).toBe(1);
  }, 60_000);

  test("a project without wrangler is told so", async () => {
    // Outside the repo, so no wrangler is in reach.
    const cwd = mkdtempSync(join(process.env.TMPDIR ?? "/tmp", "console-nowrangler-"));
    made.push(cwd);
    writeFileSync(join(cwd, "wrangler.jsonc"), "{}");

    expect(
      await openLocalBinding(cwd, { binding: "DB", configFile: join(cwd, "wrangler.jsonc") }),
    ).toBe("wrangler isn't installed here (install it, then run d1-record console again)");
  });

  test("a wrangler that fails to load is reported as that, not as missing", async () => {
    const cwd = mkdtempSync(join(process.env.TMPDIR ?? "/tmp", "console-brokenwrangler-"));
    made.push(cwd);
    mkdirSync(join(cwd, "node_modules/wrangler"), { recursive: true });
    writeFileSync(
      join(cwd, "node_modules/wrangler/package.json"),
      '{ "name": "wrangler", "type": "module", "exports": "./index.js" }',
    );
    writeFileSync(
      join(cwd, "node_modules/wrangler/index.js"),
      'throw new Error("engine mismatch");',
    );
    writeFileSync(join(cwd, "wrangler.jsonc"), "{}");

    expect(
      await openLocalBinding(cwd, { binding: "DB", configFile: join(cwd, "wrangler.jsonc") }),
    ).toBe("Couldn't load wrangler: engine mismatch");
  });

  test("a config wrangler rejects is reported with wrangler's reason", async () => {
    const cwd = project({
      binding: "DB",
      database_name: "shop",
      database_id: "local-shop",
    });
    writeFileSync(
      join(cwd, "wrangler.jsonc"),
      JSON.stringify({
        compatibility_date: "not-a-date",
        d1_databases: [{ binding: "DB", database_name: "shop", database_id: "local-shop" }],
      }),
    );

    const opened = await openLocalBinding(cwd, {
      binding: "DB",
      configFile: join(cwd, "wrangler.jsonc"),
    });

    expect(opened).toMatch(/^Wrangler couldn't open DB: /);
  }, 60_000);
});
