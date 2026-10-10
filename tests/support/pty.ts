import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";

const driver = new URL("./pty-session.py", import.meta.url).pathname;

/** One thing a person at a terminal does: see some text, type, wait, or watch the command end. */
export type PtyStep =
  | { expect: string; timeout?: number }
  | { send: string; typing?: number }
  | { wait: number }
  | { exit: number };

/** What happened: everything printed (escape codes included), the exit code, and a failed step. */
export interface PtyResult {
  transcript: string;
  exitCode: number | null;
  failed: string | null;
}

/**
 * Whether a pseudo-terminal can be had here: Python 3 on a system with ptys. A person's keyboard
 * and screen behave differently from piped streams (a paste arrives a line at a time, typing
 * triggers completion), so what depends on that is checked through this, not through streams.
 */
export const ptyAvailable =
  process.platform !== "win32" &&
  spawnSync("python3", ["-I", "-c", "import pty"], { stdio: "ignore" }).status === 0;

/** Runs `argv` in `cwd` on a pseudo-terminal and plays `steps` at it. */
export async function inPty(spec: {
  cwd: string;
  argv: string[];
  steps: PtyStep[];
}): Promise<PtyResult> {
  const { stdout } = await promisify(execFile)("python3", ["-I", driver, JSON.stringify(spec)], {
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(stdout) as PtyResult;
}
