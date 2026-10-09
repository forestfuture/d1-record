// A console session: a REPL on any streams, with the project's Models and database in scope (#104).
import { inspect } from "node:util";
import repl from "node:repl";
import type { Readable, Writable } from "node:stream";

export interface SessionOptions {
  input: Readable;
  output: Writable;
  /** What the session can name: the Models, and `db`. */
  scope: Record<string, unknown>;
}

/** Starts the session; `closed` resolves when it ends (end of input, or `.exit`). */
export function startSession({ input, output, scope }: SessionOptions): { closed: Promise<void> } {
  const server = repl.start({
    prompt: "> ",
    input,
    output,
    terminal: false,
    useGlobal: false,
    writer: (value: unknown) => `#=> ${inspect(value)}`,
  });
  Object.assign(server.context, scope);
  return { closed: new Promise((resolve) => server.on("exit", resolve)) };
}
