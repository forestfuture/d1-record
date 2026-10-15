import { describe, expect, test } from "vite-plus/test";
import { main } from "../../cli/main.ts";

/** `d1-record --help`, as it reads today: the commands, the columns, and each one's flags. */
const help = `Usage:
  d1-record schema [options]              Generate src/db/schema.ts from your D1 migrations
  d1-record g model <Name> [columns]      Write a CREATE TABLE migration and a Model
  d1-record g migration <Name> [columns]  Write a migration: Create…, Add…To…, Remove…From…, or empty
  d1-record console (or c)                Open a console on your D1 database, with your Models

Columns are name:type, where the type is string (the default), integer, real, boolean,
datetime, json or references; then ! for NOT NULL, =value for a default, and :unique or
:index for an index. For example: email:string!:unique active:boolean!=false user:references

Options for schema:
  --check             Fail if the generated schema is out of date (for CI)
  --watch             Regenerate whenever a migration changes
  --out <file>        Write here instead (a folder, with several databases)
  --migrations <dir>  Read migrations from here instead
  --models <dir>      Write ApplicationRecord here (src/models by default)

Options for g:
  --id integer        Give the table an INTEGER key D1 generates (a TEXT key made in code by default)
  --no-timestamps     Leave out created_at and updated_at
  --models <path>     Write Models here (src/models), or append them to one file (src/models.ts);
                      ApplicationRecord is imported from the same folder
  --database <name>   The D1 binding to use, when the config has several
  --out <file>        The schema file to regenerate, when it isn't src/db/schema.ts

Options for console:
  --database <name>   The D1 binding to open, when the config has several
  --models <path>     Where the Models are: a folder (src/models) or one file (src/models.ts)
  --remote            Open your remote database instead, after asking you to type its name
  --yes               Don't ask first (with --remote); also how to open it without a terminal
  --history           Keep what you type, which a remote session doesn't unless asked
  --no-history        Don't keep what you type in .wrangler/d1-record-history
  --verbose           Print each statement a line runs (.verbose toggles it while it runs)
  -e, --eval <code>   Run this code, print its result, and exit (only the result goes to stdout)

Options for every command:
  --config <file>     Use this Wrangler config
  -h, --help          Show this help`;

describe("d1-record's help", () => {
  test("--help prints the usage, word for word", () => {
    const output: string[] = [];

    expect(main(["--help"], (line) => output.push(line))).toBe(0);
    expect(output).toEqual([help]);
  });

  test("an unknown flag prints what went wrong, then the whole usage", () => {
    const output: string[] = [];

    expect(main(["schema", "--chek"], (line) => output.push(line))).toBe(1);
    expect(output).toHaveLength(1);
    expect(output[0]).toMatch(/^Unknown option '--chek'/);
    expect(output[0]?.endsWith(`\n\n${help}`)).toBe(true);
  });
});
