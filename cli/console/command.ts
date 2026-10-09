// `d1-record console`: opens the project's local D1 with its Models, in a REPL (#104).
import { dirname, join } from "node:path";
import type { Readable, Writable } from "node:stream";
import { openLocalBinding } from "./binding.ts";
import { databaseFor } from "./database.ts";
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
  /** Keep what is typed on a terminal in the history file; on unless `false`. */
  history?: boolean;
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
  const opened = await openLocalBinding(cwd, chosen);
  if (typeof opened === "string") return refused(print, opened);
  try {
    const { library, models } = project;
    const database = library.connect(opened.binding);
    print(opened.description);
    print(`Models: ${Object.keys(models).join(", ")}`);
    let modelNames = Object.keys(models);
    const session = startSession({
      ...io,
      scope: { ...models, db: database },
      commands: {
        reload: {
          help: "Read your Models again, after editing them (also: reload!)",
          bang: true,
          run: async (_argument, scope) => {
            const again = await project.reload();
            if (typeof again === "string") return again;
            for (const name of modelNames) delete scope[name];
            Object.assign(scope, again);
            modelNames = Object.keys(again);
            return `Reloaded: ${modelNames.join(", ")}`;
          },
        },
      },
      withDatabase: async (run) => void (await library.withDatabase(database, run)),
      historyFile: options.history === false ? undefined : historyFileFor(chosen.configFile),
    });
    await session.closed;
  } finally {
    await opened.dispose();
  }
  return 0;
}
