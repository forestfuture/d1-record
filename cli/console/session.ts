// A console session: a REPL on any streams, with the project's Models and database in scope (#104).
import { inspect } from "node:util";
import repl from "node:repl";
import type { Readable, Writable } from "node:stream";

export interface SessionOptions {
  input: Readable;
  output: Writable;
  /** What the session can name: the Models, and `db`. */
  scope: Record<string, unknown>;
  /** The project's own `withDatabase`, bound to its database: runs `run` with Models using it. */
  withDatabase: (run: () => void) => Promise<void>;
}

/** Starts the session; `closed` resolves when it ends (end of input, or `.exit`). */
export function startSession({ input, output, scope, withDatabase }: SessionOptions): {
  closed: Promise<void>;
} {
  const server = repl.start({
    prompt: "> ",
    input,
    output,
    terminal: false,
    useGlobal: false,
    writer: (value: unknown) => `#=> ${inspect(value)}`,
  });
  Object.assign(server.context, scope);
  // The REPL's input events don't inherit an async context, so each line runs inside its own
  // withDatabase: the Models' statics find the session's database, and so do the records they load.
  const evaluate = server.eval;
  const inDatabase: repl.REPLEval = (code, context, file, callback) => {
    void withDatabase(() => evaluate.call(server, code, context, file, callback));
  };
  // Typed read-only, but Node's REPL calls `eval` afresh for each line.
  (server as { eval: repl.REPLEval }).eval = inDatabase;
  return { closed: new Promise((resolve) => server.on("exit", resolve)) };
}
