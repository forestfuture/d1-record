// The `d1-record` command line. Node only: no Worker imports it (cli/bin.ts runs it).
import { parseArgs, type ParseArgsOptionsConfig } from "node:util";
import { runGenerate } from "./generate/command.ts";
import { runSchema, watchSchema } from "./schema/command.ts";

const help = `Usage:
  d1-record schema [options]              Generate src/db/schema.ts from your D1 migrations
  d1-record g model <Name> [columns]      Write a CREATE TABLE migration and a Model
  d1-record g migration <Name> [columns]  Write a migration: Create…, Add…To…, Remove…From…, or empty

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

  --config <file>     Use this Wrangler config
  -h, --help          Show this help`;

const shared = {
  config: { type: "string" },
  help: { type: "boolean", short: "h" },
} as const satisfies ParseArgsOptionsConfig;

const schemaOptions = {
  ...shared,
  check: { type: "boolean" },
  watch: { type: "boolean" },
  out: { type: "string" },
  migrations: { type: "string" },
  models: { type: "string" },
} as const satisfies ParseArgsOptionsConfig;

const generateOptions = {
  ...shared,
  id: { type: "string" },
  "no-timestamps": { type: "boolean" },
  models: { type: "string" },
  database: { type: "string" },
} as const satisfies ParseArgsOptionsConfig;

/** Parses `argv` with a command's options, or says why it can't (an unknown flag, a missing value). */
function argsOf<O extends ParseArgsOptionsConfig>(argv: readonly string[], options: O) {
  try {
    return parseArgs({ args: [...argv], allowPositionals: true, options });
  } catch (error) {
    return (error as Error).message;
  }
}

/** `d1-record schema`, once or watching. */
function schema(argv: readonly string[], print: (line: string) => void): number | "watching" {
  const args = argsOf(argv, schemaOptions);
  if (typeof args === "string") return usage(print, args);
  const { watch, help: _, ...options } = args.values;
  if (args.positionals.length > 0) return usage(print, `Unexpected ${args.positionals[0]}`);
  if (!watch) return runSchema(options, print);
  watchSchema(options, print);
  return "watching";
}

/** `d1-record g model …` and `d1-record g migration …`. */
function generate(argv: readonly string[], print: (line: string) => void): number {
  const args = argsOf(argv, generateOptions);
  if (typeof args === "string") return usage(print, args);
  const [kind, name, ...columns] = args.positionals;
  const { id, "no-timestamps": noTimestamps, models, database, config } = args.values;
  if ((kind !== "model" && kind !== "migration") || name === undefined) {
    return usage(print, "Name what to generate: g model <Name> or g migration <Name>");
  }
  if (id !== undefined && id !== "integer" && id !== "text") {
    return usage(print, `--id is integer or text, not ${id}`);
  }
  const options = { kind, name, columns, models, database, config } as const;
  return runGenerate({ ...options, integerId: id === "integer", timestamps: !noTimestamps }, print);
}

/** Prints the usage, after what went wrong; 1. */
function usage(print: (line: string) => void, problem: string): number {
  print(`${problem}\n\n${help}`);
  return 1;
}

/** A command: it runs with the arguments after its name, and returns the exit code. */
type Command = (argv: readonly string[], print: (line: string) => void) => number | "watching";

const commands: Record<string, Command> = { schema, g: generate, generate };

/** Runs the command line; resolves to the exit code (or never, while watching). */
export function main(argv: readonly string[], print = console.log): number | "watching" {
  const [command = "", ...rest] = argv;
  const run = Object.hasOwn(commands, command) ? commands[command] : undefined;
  const asked = [command, ...rest].some((arg) => arg === "--help" || arg === "-h");
  if (run === undefined || asked) {
    print(help);
    return asked ? 0 : 1;
  }
  if (process.getBuiltinModule?.("node:sqlite") === undefined) {
    print(
      `d1-record ${command} needs Node 22.13 or later, for node:sqlite (this is Node ${process.versions.node})`,
    );
    return 1;
  }
  return run(rest, print);
}
