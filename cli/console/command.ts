// `d1-record console`: opens the project's D1, local or remote, with its Models, in a REPL (#104).
import { basename, dirname, join } from "node:path";
import type { Readable, Writable } from "node:stream";
import { openLocalBinding, openRemoteBinding, type OpenBinding } from "./binding.ts";
import { consoleCommands } from "./commands.ts";
import { confirmRemote } from "./confirm.ts";
import { databaseFor, remoteTarget, type ChosenDatabase } from "./database.ts";
import { loadProject } from "./project.ts";
import { startSession } from "./session.ts";

export interface ConsoleOptions {
  /** The project's folder; the current one by default. */
  cwd?: string;
  /** The Wrangler config file, in place of finding it. */
  config?: string;
  /** The D1 binding to open, when the config has several. */
  database?: string;
  /** Where the Models are: a folder or one file (`src/models`). */
  models?: string;
  /** Keep what is typed on a terminal in the history file; on, unless remote, by default. */
  history?: boolean;
  /** Open the project's real D1 database instead of the local one, after asking. */
  remote?: boolean;
  /** With `remote`: don't ask first, which is also how to open it without a terminal. */
  yes?: boolean;
  /** Print each statement as it runs, to begin with; `.verbose` turns it on and off. */
  verbose?: boolean;
}

/** The two ends of the console, and whether they are a terminal (colors, line editing, history). */
export interface ConsoleIo {
  input: Readable;
  output: Writable;
  terminal?: boolean;
}

/** Where the console reads and writes: the person's terminal. */
function standardIo(): ConsoleIo {
  return { input: process.stdin, output: process.stdout, terminal: process.stdout.isTTY };
}

/** Where the history is kept: beside the project's local state, which Wrangler projects ignore. */
function historyFileFor(configFile: string): string {
  return join(dirname(configFile), ".wrangler/d1-record-history");
}

/** Says why the console can't open; 1. */
function refused(print: (line: string) => void, problem: string): number {
  print(problem);
  return 1;
}

/** Red on a terminal, so a session on the real database can't be taken for a local one. */
function promptFor(remote: boolean, terminal: boolean): string {
  const prompt = remote ? "remote> " : "local> ";
  return remote && terminal ? `\u001b[31m${prompt}\u001b[39m` : prompt;
}

/** Why a remote database can't be opened yet (or, after asking, the answer was no); else nothing. */
async function remoteRefusal(
  chosen: ChosenDatabase,
  yes: boolean,
  io: ConsoleIo,
): Promise<string | undefined> {
  const target = remoteTarget(chosen);
  if (target.id === undefined) {
    return `${chosen.binding} has no database_id in ${basename(chosen.configFile)}, which --remote needs`;
  }
  if (yes) return undefined;
  if (io.terminal !== true) {
    return "Opening a remote database asks you to confirm it: run this on a terminal, or add --yes";
  }
  const confirmed = await confirmRemote({
    input: io.input,
    output: io.output,
    binding: chosen.binding,
    target,
  });
  return confirmed ? undefined : "Not opened.";
}

/** The database to open, after the confirmation a remote one needs; or why not. */
async function openDatabase(
  cwd: string,
  chosen: ChosenDatabase,
  options: ConsoleOptions,
  io: ConsoleIo,
): Promise<OpenBinding | string> {
  if (options.remote !== true) return openLocalBinding(cwd, chosen);
  const refusal = await remoteRefusal(chosen, options.yes === true, io);
  return refusal ?? openRemoteBinding(cwd, chosen);
}

/** Runs the console until its input ends; the exit code. */
export async function runConsole(
  options: ConsoleOptions,
  print: (line: string) => void,
  io: ConsoleIo = standardIo(),
): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const chosen = databaseFor(cwd, options);
  if (typeof chosen === "string") return refused(print, chosen);
  const project = await loadProject(cwd, options.models);
  if (typeof project === "string") return refused(print, project);
  const opened = await openDatabase(cwd, chosen, options, io);
  if (typeof opened === "string") return refused(print, opened);
  const remote = options.remote === true;
  try {
    const { library, models } = project;
    const { commands, onQuery } = consoleCommands(project, {
      verbose: options.verbose === true,
      write: (line) => io.output.write(`${line}\n`),
      dim: io.terminal === true,
    });
    const database = library.connect(opened.binding, { onQuery });
    print(opened.description);
    print(`Models: ${Object.keys(models).join(", ")}`);
    const session = startSession({
      ...io,
      scope: { ...models, db: database },
      commands,
      withDatabase: async (run) => void (await library.withDatabase(database, run)),
      prompt: promptFor(remote, io.terminal === true),
      // What is typed against a real database stays out of the history unless it is asked for.
      historyFile: (options.history ?? !remote) ? historyFileFor(chosen.configFile) : undefined,
    });
    await session.closed;
  } finally {
    await opened.dispose();
  }
  return 0;
}
