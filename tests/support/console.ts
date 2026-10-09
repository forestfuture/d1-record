import { PassThrough } from "node:stream";
import { startSession, type SessionOptions } from "../../cli/console/session.ts";

/** A console's two ends, as a person at a terminal would use them. */
export function terminalStreams() {
  const input = new PassThrough();
  const output = new PassThrough();
  let printed = "";
  const waiting: (() => void)[] = [];
  output.on("data", (chunk: Buffer) => {
    printed += chunk.toString();
    if (printed.endsWith("> ")) for (const wake of waiting.splice(0)) wake();
  });
  const ready = () =>
    new Promise<void>((resolve) => {
      if (printed.endsWith("> ")) resolve();
      else waiting.push(resolve);
    });
  return {
    input,
    output,
    /** Resolves when the console asks for a line, then forgets what it printed so far. */
    async ready(): Promise<void> {
      await ready();
      printed = "";
    },
    /** Types a line; resolves with what the console printed before it asked for the next one. */
    async send(line: string): Promise<string> {
      printed = "";
      input.write(`${line}\n`);
      await ready();
      return printed.replace(/> $/, "").trim();
    },
  };
}

/** Drives a console session started directly on these options. */
export async function drive(options: Omit<SessionOptions, "input" | "output">) {
  const terminal = terminalStreams();
  const session = startSession({ ...options, input: terminal.input, output: terminal.output });
  await terminal.ready();
  return {
    send: (line: string) => terminal.send(line),
    async close(): Promise<void> {
      terminal.input.end();
      await session.closed;
    },
  };
}
