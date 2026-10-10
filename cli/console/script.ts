// Running one piece of code in the console's scope and reporting what it came to: `console -e` (#105).
import { Readable, Writable } from "node:stream";
import { inspect } from "node:util";
import { startSession, type LineOutcome, type SessionOptions } from "./session.ts";

/** What a script printed, for stdout and stderr, and whether it succeeded (0) or not (1). */
export interface ScriptResult {
  exitCode: 0 | 1;
  stdout: string;
  stderr: string;
}

/** The result as `node -p` prints it: a string as it is, anything else as inspect shows it. */
function shown(value: unknown, colors: boolean): string {
  return typeof value === "string" ? value : inspect(value, { colors });
}

/**
 * Runs `code` as the console would run a line (top-level `await`, the Models and `db` in scope,
 * each statement inside the project's `withDatabase`). The last result is printed unless it is
 * undefined; a failure prints nothing on stdout, and its stack on stderr, and no later line runs.
 */
export async function runScript({
  code,
  scope,
  commands,
  withDatabase,
  colors = false,
}: {
  code: string;
  colors?: boolean;
} & Pick<SessionOptions, "scope" | "commands" | "withDatabase">): Promise<ScriptResult> {
  let last: LineOutcome | undefined;
  const session = startSession({
    input: Readable.from([`${code}\n`]),
    // The REPL's own prompts and echoes have nowhere to go: the outcome is reported instead.
    output: new Writable({ write: (_chunk, _encoding, done) => done() }),
    scope,
    commands,
    withDatabase,
    onLine: (outcome) => {
      if (last?.ok !== false) last = outcome;
    },
  });
  await session.closed;
  if (last?.ok === false) {
    return { exitCode: 1, stdout: "", stderr: `${inspect(last.error, { colors })}\n` };
  }
  const value = last?.value;
  return {
    exitCode: 0,
    stdout: value === undefined ? "" : `${shown(value, colors)}\n`,
    stderr: "",
  };
}
