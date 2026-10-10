// `d1-record console`: opens the project's D1, local or remote, with its Models, and runs a REPL or one piece of code (#104, #105).
import { basename, dirname, join } from "node:path";
import type { Readable, Writable } from "node:stream";
import { WriteStream } from "node:tty";
import { openLocalBinding, openRemoteBinding, type OpenBinding } from "./binding.ts";
import { consoleCommands } from "./commands.ts";
import { confirmRemote } from "./confirm.ts";
import { databaseFor, remoteTarget, type ChosenDatabase } from "./database.ts";
import { loadProject, type ConsoleProject } from "./project.ts";
import { runScript } from "./script.ts";
import { startSession, type SessionOptions } from "./session.ts";

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
  /**
   * Run this code and exit, instead of opening a session: its result goes to the output, and
   * everything else the console says (the database, the SQL, a failure) goes to the error stream.
   */
  eval?: string;
}

/** The two ends of the console, and whether they are a terminal (colors, line editing, history). */
export interface ConsoleIo {
  input: Readable;
  output: Writable;
  /** Where a script's diagnostics go: the process's stderr by default. */
  error?: Writable;
  terminal?: boolean;
}

/** Where the console reads and writes: the person's terminal. */
export function standardIo(): ConsoleIo {
  // Both: a pipe on either end means no person is there to answer for what a console may change.
  const terminal = process.stdin.isTTY === true && process.stdout.isTTY === true;
  return { input: process.stdin, output: process.stdout, error: process.stderr, terminal };
}

/**
 * Where the history is kept: beside the project's local state, which Wrangler projects ignore. A
 * remote session has a file of its own, so a line typed against the real database is never
 * offered, with the up arrow, to a local session (or the other way round).
 */
function historyFileFor(configFile: string, remote: boolean): string {
  return join(dirname(configFile), `.wrangler/d1-record-history${remote ? "-remote" : ""}`);
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

/**
 * The real database, once it is allowed: it has an id, and the person confirmed it (on a terminal)
 * or said `--yes`. Input typed behind the confirmation is dropped until the database is open.
 */
async function openRemote(
  cwd: string,
  chosen: ChosenDatabase,
  options: ConsoleOptions,
  io: ConsoleIo,
): Promise<OpenBinding | string> {
  const target = remoteTarget(chosen);
  if (target.id === undefined) {
    return `${chosen.binding} has no database_id in ${basename(chosen.configFile)}, which --remote needs`;
  }
  let release = async () => {};
  if (options.yes !== true) {
    if (io.terminal !== true) {
      return "Opening a remote database asks you to confirm it: run this on a terminal, or add --yes";
    }
    const confirmation = await confirmRemote({
      input: io.input,
      output: io.output,
      binding: chosen.binding,
      target,
    });
    ({ release } = confirmation);
    if (!confirmation.confirmed) {
      await release();
      return "Not opened.";
    }
  }
  const opened = await openRemoteBinding(cwd, chosen);
  await release();
  return opened;
}

/** Whether a stream is a terminal, which colors what is written to it. */
function isTerminal(stream: Writable): boolean {
  return stream instanceof WriteStream;
}

/** What a session needs from the open database: the scope, and how to run a line inside it. */
type Opened = Pick<SessionOptions, "scope" | "commands" | "withDatabase">;

/** Runs `code` once, and writes its result and its failure where each belongs; the exit code. */
async function runOnce(code: string, opened: Opened, io: ConsoleIo, errors: Writable) {
  const result = await runScript({
    code,
    ...opened,
    colors: { result: isTerminal(io.output), error: isTerminal(errors) },
  });
  io.output.write(result.stdout);
  errors.write(result.stderr);
  return result.exitCode;
}

/** What opening the console found: the database chosen, the project's Models, the open binding. */
interface Prepared {
  chosen: ChosenDatabase;
  project: ConsoleProject;
  opened: OpenBinding;
}

/** Everything that has to be true before a session starts, or why it isn't. */
async function prepare(
  options: ConsoleOptions,
  io: ConsoleIo,
  errors: Writable,
): Promise<Prepared | string> {
  const cwd = options.cwd ?? process.cwd();
  const chosen = databaseFor(cwd, options);
  if (typeof chosen === "string") return chosen;
  const project = await loadProject(cwd, options.models);
  if (typeof project === "string") return project;
  // A script's output is its result alone, so the confirmation's question goes to stderr.
  const asking = options.eval === undefined ? io : { ...io, output: errors };
  const opened = await (options.remote === true
    ? openRemote(cwd, chosen, options, asking)
    : openLocalBinding(cwd, chosen));
  return typeof opened === "string" ? opened : { chosen, project, opened };
}

/** Where a console talks: its own ends, what it says besides results, and its error stream. */
interface Talk {
  io: ConsoleIo;
  say: (line: string) => void;
  errors: Writable;
}

/** The session, or the one piece of code, on the open database; the exit code. */
async function converse(
  options: ConsoleOptions,
  { chosen, project, opened }: Prepared,
  { io, say, errors }: Talk,
): Promise<number> {
  const scripted = options.eval !== undefined;
  const remote = options.remote === true;
  const { library, models } = project;
  const { commands, onQuery } = consoleCommands(project, {
    verbose: options.verbose === true,
    write: scripted ? say : (line) => io.output.write(`${line}\n`),
    dim: scripted ? isTerminal(errors) : io.terminal === true,
  });
  const database = library.connect(opened.binding, { onQuery });
  say(opened.description);
  say(`Models: ${Object.keys(models).join(", ")}`);
  const inside: Opened = {
    scope: { ...models, db: database },
    commands,
    withDatabase: async (run) => void (await library.withDatabase(database, run)),
  };
  if (options.eval !== undefined) return runOnce(options.eval, inside, io, errors);
  const session = startSession({
    ...io,
    ...inside,
    prompt: promptFor(remote, io.terminal === true),
    // What is typed against a real database stays out of the history unless it is asked for.
    historyFile:
      (options.history ?? !remote) ? historyFileFor(chosen.configFile, remote) : undefined,
  });
  await session.closed;
  return 0;
}

/** Runs the console until its input ends; the exit code. */
export async function runConsole(
  options: ConsoleOptions,
  print: (line: string) => void,
  io: ConsoleIo = standardIo(),
): Promise<number> {
  const errors = io.error ?? process.stderr;
  // A script's output is its result alone: all else it says (even a refusal) goes to stderr.
  const say = options.eval === undefined ? print : (line: string) => void errors.write(`${line}\n`);
  const prepared = await prepare(options, io, errors);
  if (typeof prepared === "string") return refused(say, prepared);
  try {
    return await converse(options, prepared, { io, say, errors });
  } finally {
    await prepared.opened.dispose();
  }
}
