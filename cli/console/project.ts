// Loads a project's TypeScript Models and its own copy of the library for the console (#104).
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createJiti } from "jiti";
import { defaultModels, oneModelsFile, shown } from "../schema/project.ts";

/**
 * What the console uses of the project's `@forestfuture/d1-record`. Typed loosely on purpose: it is
 * the project's copy, loaded at run time, and not the one this command line was built against.
 */
interface Library {
  connect: (binding: unknown) => unknown;
  withDatabase: (database: unknown, run: () => unknown) => Promise<unknown>;
  Model: { Base: abstract new (...args: never[]) => unknown };
}

export interface ConsoleProject {
  library: Library;
  /** Each Model class the models folder exports, by name. */
  models: Record<string, unknown>;
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

/** The project's own `@forestfuture/d1-record`, or why it can't be loaded. */
async function loadLibrary(jiti: Jiti): Promise<Library | string> {
  try {
    jiti.esmResolve("@forestfuture/d1-record");
  } catch {
    return "@forestfuture/d1-record isn't installed here (install it, then run d1-record console again)";
  }
  try {
    return await jiti.import<Library>("@forestfuture/d1-record");
  } catch (error) {
    return `Couldn't load @forestfuture/d1-record: ${(error as Error).message}`;
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
  const files = modelFiles(cwd, models);
  if (typeof files === "string") return files;
  const jiti = createJiti(`${cwd}/`, { tsconfigPaths: true, fsCache: false, moduleCache: true });
  const library = await loadLibrary(jiti);
  if (typeof library === "string") return library;
  const found = await loadModels(cwd, jiti, files, library);
  if (typeof found === "string") return found;
  if (Object.keys(found).length === 0) {
    return `No Models in ${shown(cwd, resolve(cwd, models))} (run d1-record g model, or pass --models)`;
  }
  return { library, models: found };
}
