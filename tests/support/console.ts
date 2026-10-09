import { PassThrough } from "node:stream";
import { startSession, type SessionOptions } from "../../cli/console/session.ts";

/**
 * Drives a console session as a person would: `send` types a line and resolves with what the
 * console printed before it asked for the next one.
 */
export async function drive(options: Omit<SessionOptions, "input" | "output">) {
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
  const session = startSession({ ...options, input, output });
  await ready();
  printed = "";
  return {
    async send(line: string): Promise<string> {
      printed = "";
      input.write(`${line}\n`);
      await ready();
      return printed.replace(/> $/, "").trim();
    },
    async close(): Promise<void> {
      input.end();
      await session.closed;
    },
  };
}
