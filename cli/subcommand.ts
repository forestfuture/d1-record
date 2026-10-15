// What a `d1-record` subcommand declares (flags, help, how it runs), and `defineSubcommand`, which parses a command line for it.
import { parseArgs, type ParseArgsOptionsConfig } from "node:util";
import type { Print } from "./plan.ts";

/** The flags every subcommand takes. */
export const sharedOptions = {
  config: { type: "string" },
  help: { type: "boolean", short: "h" },
} as const satisfies ParseArgsOptionsConfig;

/** The help for the shared flags, after every subcommand's own. */
export const sharedFlagHelp = `Options for every command:
  --config <file>     Use this Wrangler config
  -h, --help          Show this help`;

/** A subcommand's options and the shared ones, as one `parseArgs` table. */
type WithShared<O extends ParseArgsOptionsConfig> = O & typeof sharedOptions;

/** A command line parsed with a subcommand's options: its flags, typed from them, and positionals. */
export type Parsed<O extends ParseArgsOptionsConfig> = ReturnType<
  typeof parseArgs<{ args: string[]; allowPositionals: true; options: WithShared<O> }>
>;

/** What running a subcommand comes to: its exit code, or that it keeps running (`--watch`). */
type Outcome = number | "watching" | Promise<number>;

/** Prints what is wrong with a command line, then the usage; 1. */
type Fail = (problem: string) => number;

/** The help a subcommand gives, which `d1-record --help` joins into one usage. */
interface SubcommandHelp {
  /** Its Usage line or lines, indented as they're printed. */
  usage: string;
  /** Prose after the Usage lines, if it needs some. */
  notes?: string;
  /** Its "Options for …" block. */
  flagHelp: string;
}

/** A subcommand as written: its help, its flags, and what it does with them once parsed. */
interface SubcommandSpec<O extends ParseArgsOptionsConfig> extends SubcommandHelp {
  /** Its own flags (the shared ones are added). */
  options: O;
  run(parsed: Parsed<O>, print: Print, fail: Fail): Outcome;
}

/** A subcommand ready to run: it parses the arguments after its name, and runs. */
export interface Subcommand extends SubcommandHelp {
  options: ParseArgsOptionsConfig;
  run(argv: readonly string[], print: Print, fail: Fail): Outcome;
}

/** A subcommand from its spec: its `run` gets the command line parsed, or `fail` says why it can't be. */
export function defineSubcommand<const O extends ParseArgsOptionsConfig>(
  spec: SubcommandSpec<O>,
): Subcommand {
  const options: WithShared<O> = { ...sharedOptions, ...spec.options };
  return {
    ...spec,
    run(argv, print, fail) {
      let parsed: Parsed<O>;
      try {
        parsed = parseArgs({ args: [...argv], allowPositionals: true, options });
      } catch (error) {
        return fail((error as Error).message);
      }
      return spec.run(parsed, print, fail);
    },
  };
}
