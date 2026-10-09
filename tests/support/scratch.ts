import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vite-plus/test";

// Inside tests/ (gitignored): a project there finds this repo's node_modules, as an app finds its own.
const inRepo = new URL("../.scratch/", import.meta.url).pathname;

/**
 * Throwaway folders for a test file, removed when it finishes. Call once at the top of the file.
 * `outsideTheRepo` makes one in the system's temp folder, out of reach of this repo's node_modules
 * and tsconfig.
 */
export function scratchDirs() {
  const made: string[] = [];
  afterAll(() => {
    for (const dir of made) rmSync(dir, { recursive: true, force: true });
  });
  return (prefix: string, outsideTheRepo = false): string => {
    if (!outsideTheRepo) mkdirSync(inRepo, { recursive: true });
    const dir = mkdtempSync(join(outsideTheRepo ? tmpdir() : inRepo, prefix));
    made.push(dir);
    return dir;
  };
}
