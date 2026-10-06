// What a command decides to do, apart from doing it: the files to write and the lines to
// print. Commands plan from a snapshot of the project (cli/schema/snapshot.ts), and `apply`
// is the one place that writes (#95).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** A file a command writes: where, and what. */
export interface FileToWrite {
  path: string;
  source: string;
}

/** Everything a command does: the files it writes, what it prints, and its exit code. */
export interface Plan {
  files: FileToWrite[];
  lines: string[];
  code: number;
}

/** Several plans as one: every file and line, in order, and the worst exit code. */
export function combined(plans: readonly Plan[]): Plan {
  return {
    files: plans.flatMap((plan) => plan.files),
    lines: plans.flatMap((plan) => plan.lines),
    code: Math.max(0, ...plans.map((plan) => plan.code)),
  };
}

/** Writes a plan's files, making their folders, then prints its lines. Returns the exit code. */
export function apply(plan: Plan, print: (line: string) => void): number {
  for (const file of plan.files) {
    mkdirSync(dirname(file.path), { recursive: true });
    writeFileSync(file.path, file.source);
  }
  for (const line of plan.lines) print(line);
  return plan.code;
}
