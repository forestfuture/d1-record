// Loads (and reloads) a project's TypeScript Models and its own copy of the library for the console (#104).
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createJiti } from "jiti";
import { defaultModels, oneModelsFile, shown } from "../schema/project.ts";
import type { StatementEvent } from "./verbose.ts";

/**
 * What the console uses of the project's `@forestfuture/d1-record`. Typed loosely on purpose: it is
 * the project's copy, loaded at run time, and not the one this command line was built against.
 */
interface Library {
  connect: (binding: unknown, options?: { onQuery?: (event: StatementEvent) => void }) => unknown;
  withDatabase: (database: unknown, run: () => unknown) => Promise<unknown>;
  Model: { Base: abstract new (...args: never[]) => unknown };
}

export interface ConsoleProject {
  library: Library;
  /** Each Model class the models folder exports, by name. */
  models: Record<string, unknown>;
  /**
   * Reads the project's files again, so edits show: the Models now, or why they can't be loaded
   * (the loaded Models are left as they were). The library is not reloaded: it stays one copy.
   */
  reload: () => Promise<Record<string, unknown> | string>;
}

/** The Model files: the folder's `.ts` files, or the one file `--models` names. */
function modelFiles(cwd: string, models: string): string[] | string {
  const path = resolve(cwd, models);
  if (!existsSync(path)) {
    return `No Models at ${shown(cwd, path)} (run d1-record g model, or pass --models)`;
  }
  if (oneModelsFile(models) || statSync(path).isFile()) return [path];
  return readdirSync(path)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".d.ts"))
    .sort()
    .map((name) => join(path, name));
}

type Jiti = ReturnType<typeof createJiti>;

const libraryName = "@forestfuture/d1-record";

/** Whether `error` is the loader failing to find `name` itself, not something it imports. */
function isMissing(error: unknown, name: string): boolean {
  const { code, message } = error as { code?: unknown; message?: unknown };
  return (
    (code === "MODULE_NOT_FOUND" || code === "ERR_MODULE_NOT_FOUND") &&
    String(message).startsWith(`Cannot find module '${name}'`)
  );
}

/**
 * The project's own `@forestfuture/d1-record`, or why it can't be loaded. It is imported from a
 * file in the project, as its Models import it, because only imports made inside a file follow a
 * `tsconfig.json` path (a workspace link), and so the Models and the console get one copy.
 */
async function loadLibrary(cwd: string, jiti: Jiti): Promise<Library | string> {
  try {
    const source = `export * from "${libraryName}";`;
    const filename = join(cwd, "d1-record-console.ts");
    return (await jiti.evalModule(source, { filename, async: true })) as Library;
  } catch (error) {
    if (isMissing(error, libraryName)) {
      return `${libraryName} isn't installed here (install it, then run d1-record console again)`;
    }
    return `Couldn't load ${libraryName}: ${(error as Error).message}`;
  }
}

/** The Model classes the files export, by name; or the file that couldn't be loaded. */
async function loadModels(
  cwd: string,
  jiti: Jiti,
  files: readonly string[],
  library: Library,
): Promise<Record<string, unknown> | string> {
  const found: Record<string, unknown> = {};
  for (const file of files) {
    let exported: Record<string, unknown>;
    try {
      exported = await jiti.import<Record<string, unknown>>(file);
    } catch (error) {
      return `Couldn't load ${shown(cwd, file)}: ${(error as Error).message}`;
    }
    for (const [name, value] of Object.entries(exported)) {
      if (typeof value === "function" && value.prototype instanceof library.Model.Base) {
        found[name] = value;
      }
    }
  }
  return found;
}

/** The Models found in the files now, or why there are none to use. */
async function modelsIn(
  cwd: string,
  models: string,
  jiti: Jiti,
  library: Library,
): Promise<Record<string, unknown> | string> {
  const files = modelFiles(cwd, models);
  if (typeof files === "string") return files;
  const found = await loadModels(cwd, jiti, files, library);
  if (typeof found === "string") return found;
  if (Object.keys(found).length === 0) {
    return `No Models in ${shown(cwd, resolve(cwd, models))} (run d1-record g model, or pass --models)`;
  }
  return found;
}

/** A path with forward slashes, to compare file names whatever the system's separator is. */
const slashed = (path: string): string => path.replaceAll("\\", "/");

/**
 * Forgets the project's own modules, so they are read again. Its dependencies stay as they are,
 * and so do `keep` (the library's files, which may sit under the project's folder).
 */
function forgetProjectFiles(cwd: string, jiti: Jiti, keep: ReadonlySet<string>): void {
  const folder = `${slashed(resolve(cwd))}/`;
  for (const file of Object.keys(jiti.cache)) {
    const name = slashed(file);
    if (name.startsWith(folder) && !name.includes("/node_modules/") && !keep.has(file)) {
      delete jiti.cache[file];
    }
  }
}

/**
 * The project's Models and library, loaded as its own code would load them: one `jiti` based in
 * the project reads TypeScript, extensionless imports and `tsconfig.json` paths, and resolves
 * `@forestfuture/d1-record` from the project's `node_modules`, so the Models and the console
 * share a single copy of the library. Or why they can't be loaded.
 */
export async function loadProject(
  cwd: string,
  models = defaultModels,
): Promise<ConsoleProject | string> {
  // A missing models folder is reported before a missing library, as it always has been.
  const files = modelFiles(cwd, models);
  if (typeof files === "string") return files;
  const jiti = createJiti(`${cwd}/`, { tsconfigPaths: true, fsCache: false, moduleCache: true });
  const loadedBefore = new Set(Object.keys(jiti.cache));
  const library = await loadLibrary(cwd, jiti);
  if (typeof library === "string") return library;
  const libraryFiles = new Set(Object.keys(jiti.cache).filter((file) => !loadedBefore.has(file)));
  const found = await modelsIn(cwd, models, jiti, library);
  if (typeof found === "string") return found;
  const project: ConsoleProject = {
    library,
    models: found,
    reload: async () => {
      forgetProjectFiles(cwd, jiti, libraryFiles);
      const again = await modelsIn(cwd, models, jiti, library);
      if (typeof again !== "string") project.models = again;
      return again;
    },
  };
  return project;
}
