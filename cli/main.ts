// The `d1-record` command line. Node only: no Worker imports it (cli/bin.ts runs it).
import { parseArgs } from "node:util";
import { runSchema, watchSchema } from "./schema/command.ts";

const help = `Usage: d1-record schema [options]

Generates src/db/schema.ts from your D1 migrations, found through your Wrangler config.

Options:
  --check             Fail if the generated schema is out of date (for CI)
  --watch             Regenerate whenever a migration changes
  --out <file>        Write here instead (a folder, with several databases)
  --migrations <dir>  Read migrations from here instead
  --config <file>     Use this Wrangler config
  -h, --help          Show this help`;

const options = {
  check: { type: "boolean" },
  watch: { type: "boolean" },
  out: { type: "string" },
  migrations: { type: "string" },
  config: { type: "string" },
  help: { type: "boolean", short: "h" },
} as const;

/** The parsed arguments, or why they can't be (an unknown flag, a missing value). */
function argsOf(argv: readonly string[]) {
  try {
    return parseArgs({ args: [...argv], allowPositionals: true, options });
  } catch (error) {
    return (error as Error).message;
  }
}

/** Runs the command line; resolves to the exit code (or never, while watching). */
export function main(argv: readonly string[], print = console.log): number | "watching" {
  const args = argsOf(argv);
  if (typeof args === "string") {
    print(`${args}\n\n${help}`);
    return 1;
  }
  const { values, positionals } = args;
  if (values.help || positionals[0] !== "schema") {
    print(help);
    return values.help ? 0 : 1;
  }
  if (process.getBuiltinModule?.("node:sqlite") === undefined) {
    print(
      `d1-record schema needs Node 22.13 or later, for node:sqlite (this is Node ${process.versions.node})`,
    );
    return 1;
  }
  const { watch, help: _, ...schemaOptions } = values;
  if (watch) {
    watchSchema(schemaOptions, print);
    return "watching";
  }
  return runSchema(schemaOptions, print);
}
