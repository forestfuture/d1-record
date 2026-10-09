// A console session: a REPL on any streams, with the project's Models and database in scope (#104).
import { inspect, types } from "node:util";
import repl from "node:repl";
import { PassThrough, type Readable, type Writable } from "node:stream";

export interface SessionOptions {
  input: Readable;
  output: Writable;
  /** A terminal gets colors, line editing and history; piped input gets plain text. */
  terminal?: boolean;
  /** Where to keep what was typed, between sessions; only a terminal has history. */
  historyFile?: string;
  /** What the session can name: the Models, and `db`. */
  scope: Record<string, unknown>;
  /** The project's own `withDatabase`, bound to its database: runs `run` with Models using it. */
  withDatabase: (run: () => void) => Promise<void>;
}

/** A line that is just `quit` or `exit`: leaves the console, as `.exit` does. */
const leaving = /^\s*(?:quit|exit)\s*;?\s*$/;

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
    attach(server: repl.REPLServer, withDatabase: SessionOptions["withDatabase"]): void {
      const evaluate = server.eval;
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
          void withDatabase(() => evaluate.call(server, code, context, file, callback));
          return;
        }
        tail = tail.then(
          () =>
            new Promise<void>((done) => {
              if (stopped) return done();
              if (leaving.test(code)) {
                // As `.exit` does: nothing is evaluated, so nothing is printed.
                stopped = true;
                server.close();
                return done();
              }
              lineDone = done;
              void withDatabase(() => evaluate.call(server, code, context, file, callback));
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
  lines.attach(server, withDatabase);
  return {
    closed: new Promise((resolve) => server.on("exit", () => void lines.pending().then(resolve))),
  };
}
