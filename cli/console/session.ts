// A console session: a REPL on any streams, with the project's Models and database in scope (#104).
import { AsyncLocalStorage } from "node:async_hooks";
import { inspect, types } from "node:util";
import repl from "node:repl";
import { PassThrough, type Readable, type Writable } from "node:stream";

/** A command of the console itself, typed as `.name` (and `name!` too, when `bang` is set). */
export interface SessionCommand {
  /** What `.help` says about it. */
  help: string;
  /** Also runs as a line that is just `name!`. */
  bang?: boolean;
  /**
   * Runs it, with what was typed after the name and the session's scope (to change what is
   * named); resolves with what to print.
   */
  run: (argument: string, scope: Record<string, unknown>) => Promise<string> | string;
}

export interface SessionOptions {
  input: Readable;
  output: Writable;
  /** A terminal gets colors, line editing and history; piped input gets plain text. */
  terminal?: boolean;
  /** Where to keep what was typed, between sessions; only a terminal has history. */
  historyFile?: string;
  /** What the session can name: the Models, and `db`. */
  scope: Record<string, unknown>;
  /** The console's own commands, by name. */
  commands?: Record<string, SessionCommand>;
  /** The project's own `withDatabase`, bound to its database: runs `run` with Models using it. */
  withDatabase: (run: () => void) => Promise<void>;
}

/** A line that is just `quit` or `exit`: leaves the console, as `.exit` does. */
const leaving = /^\s*(?:quit|exit)\s*;?\s*$/;

/** A line that is just `name!`: one of the console's commands, as a bare word. */
const bangLine = /^\s*([A-Za-z_]\w*)!\s*$/;

/**
 * The REPL's lines, run one at a time inside the project's `withDatabase`. The REPL's input events
 * don't inherit an async context, so each line gets its own: the Models' statics find the
 * session's database, and so do the records they load. Lines pasted or piped arrive together, but
 * each waits for the one before it (an `await` in the first may be what the second uses).
 */
function lineQueue() {
  let tail: Promise<void> = Promise.resolve();
  let lineDone: (() => void) | undefined;
  let stopped = false;
  return {
    /** Settles when every line so far has finished; a later line makes the next one. */
    pending: () => tail,
    /** Runs `task` after the lines before it, and before the ones after. It must not throw. */
    enqueue(task: () => Promise<void>): void {
      tail = tail.then(() => (stopped ? undefined : task()));
    },
    attach(
      server: repl.REPLServer,
      withDatabase: SessionOptions["withDatabase"],
      /** Runs the line if it is a command typed as `name!`; undefined when it is not. */
      command: (line: string) => Promise<void> | undefined,
    ): void {
      const evaluate = server.eval;
      // While a line awaits, the REPL holds the next one back and then runs it from inside that
      // line's async context, where the database is already registered. Wrapping it again would
      // register it twice, which reads as "several databases": so a line already inside one isn't.
      const wrapped = new AsyncLocalStorage<true>();
      const inTheDatabase = (task: () => void): void => {
        if (wrapped.getStore() === true) task();
        else void withDatabase(() => wrapped.run(true, task));
      };
      // A line is done when the REPL asks for the next: it doesn't call the eval callback for an
      // `await` that rejects, but it always shows the prompt again.
      const displayPrompt = server.displayPrompt.bind(server);
      server.displayPrompt = (preserveCursor) => {
        try {
          displayPrompt(preserveCursor);
        } finally {
          lineDone?.();
        }
      };
      const inDatabase: repl.REPLEval = (code, context, file, callback) => {
        // The REPL ends a line it evaluates with a newline. Its completion evaluates the
        // receiver of what is being typed (`try { await User } catch {}`) through this same
        // function while a person types: those never end in a prompt, so they must not wait in
        // the queue (or hold it up), but they still run where Models find their database.
        if (!code.endsWith("\n")) {
          inTheDatabase(() => evaluate.call(server, code, context, file, callback));
          return;
        }
        tail = tail.then(
          () =>
            new Promise<void>((done) => {
              if (stopped) return done();
              const ran = command(code);
              if (ran !== undefined) {
                void ran.then(done);
                return;
              }
              if (leaving.test(code)) {
                // As `.exit` does: nothing is evaluated, so nothing is printed.
                stopped = true;
                server.close();
                return done();
              }
              lineDone = done;
              inTheDatabase(() => evaluate.call(server, code, context, file, callback));
            }),
        );
      };
      // Typed read-only, but Node's REPL calls `eval` afresh for each line.
      (server as { eval: repl.REPLEval }).eval = inDatabase;
    },
  };
}

/**
 * Piped input as the REPL sees it: its end waits until every line has finished. The REPL closes at
 * once when its input ends, even with an `await` still running, and then shows no more prompts.
 */
function untilDrained(input: Readable, pending: () => Promise<void>): Readable {
  const gated = new PassThrough();
  input.pipe(gated, { end: false });
  input.once("end", () => {
    // The lines of the last chunk reach the REPL (and the queue) before the queue is awaited.
    setImmediate(async () => {
      let last: Promise<void>;
      do {
        last = pending();
        await last;
      } while (last !== pending());
      gated.end();
    });
  });
  return gated;
}

/** Starts the session; `closed` resolves when it ends (end of input, or `.exit`). */
export function startSession({
  input,
  output,
  terminal = false,
  historyFile,
  scope,
  commands = {},
  withDatabase,
}: SessionOptions): {
  closed: Promise<void>;
} {
  const lines = lineQueue();
  const server = repl.start({
    prompt: "> ",
    input: terminal ? input : untilDrained(input, lines.pending),
    output,
    terminal,
    useColors: terminal,
    // Ctrl-C stops a running line, even an `await` that never finishes.
    breakEvalOnSigint: terminal,
    useGlobal: false,
    writer(this: repl.REPLServer, value: unknown) {
      const shown = inspect(value, { colors: this.useColors });
      return types.isNativeError(value) ? shown : `#=> ${shown}`;
    },
  });
  if (terminal && historyFile !== undefined) server.setupHistory(historyFile, () => {});
  Object.assign(server.context, scope);
  // The console's own commands run in line order, print what they say, and ask for the next line.
  const runCommand = async (name: string, argument: string): Promise<void> => {
    let message: string;
    try {
      message = await commands[name]!.run(argument, server.context as Record<string, unknown>);
    } catch (error) {
      message = `${name} failed: ${(error as Error).message}`;
    }
    output.write(`${message}\n`);
    server.displayPrompt();
  };
  for (const [name, command] of Object.entries(commands)) {
    server.defineCommand(name, {
      help: command.help,
      action(argument) {
        lines.enqueue(() => runCommand(name, argument));
      },
    });
  }
  lines.attach(server, withDatabase, (line) => {
    const name = bangLine.exec(line)?.[1];
    return name !== undefined && commands[name]?.bang ? runCommand(name, "") : undefined;
  });
  return {
    closed: new Promise((resolve) => server.on("exit", () => void lines.pending().then(resolve))),
  };
}
