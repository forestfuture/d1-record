import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { runConsole } from "../../cli/console/command.ts";
import { terminalStreams } from "../support/console.ts";
import { scratchDirs } from "../support/scratch.ts";
import { configured, remoteDatabase } from "./support.ts";

const library = new URL("../../src/index.ts", import.meta.url).pathname;
const scratch = scratchDirs();

// `d1-record console --remote` against the real smoke database, through Wrangler's remote proxy:
// what the fake wrangler in tests/integration/cli-console-remote.test.ts stands in for.
// Skipped unless configured (see support.ts).
describe.skipIf(!configured)("the console on a remote D1", () => {
  test("opens the database with --remote --yes, and its Models read and write it", async () => {
    const remote = await remoteDatabase();
    try {
      const cwd = scratch("console-remote-smoke-");
      const table = `${remote.prefix}users`;
      const files: Record<string, string> = {
        "wrangler.jsonc": JSON.stringify({
          d1_databases: [
            {
              binding: "DB",
              database_name: "d1-record-smoke",
              database_id: process.env["D1_SMOKE_DATABASE_ID"],
            },
          ],
        }),
        "tsconfig.json": JSON.stringify({
          compilerOptions: { paths: { "@forestfuture/d1-record": [library] } },
        }),
        "src/models/application-record.ts": `
          import { modelFor } from "@forestfuture/d1-record";
          export const ApplicationRecord = modelFor({
            ${JSON.stringify(table)}: {
              attributes: { id: "integer", email: "string" },
              primaryKey: "id",
            },
          } as const);
        `,
        "src/models/user.ts": `
          import { ApplicationRecord } from "./application-record";
          export class User extends ApplicationRecord(${JSON.stringify(table)}) {}
        `,
      };
      for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(join(cwd, path)), { recursive: true });
        writeFileSync(join(cwd, path), text);
      }
      const terminal = terminalStreams();
      const lines: string[] = [];

      const done = runConsole(
        { cwd, remote: true, yes: true },
        (line) => lines.push(line),
        terminal,
      );
      await terminal.ready();
      await terminal.send('await User.create({ id: 1, email: "console@example.com" })');
      const email = await terminal.send("(await User.find(1)).email");
      terminal.input.end();

      expect(lines[0]).toMatch(/^Remote database DB \(d1-record-smoke, id /);
      expect(email).toBe("#=> 'console@example.com'");
      expect(await done).toBe(0);
    } finally {
      await remote.dispose();
    }
  }, 180_000);
});
