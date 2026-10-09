// The console's D1 binding: the project's local database, opened through its own Wrangler (#104).
import { dirname, join } from "node:path";
import { createJiti } from "jiti";
import type { ChosenDatabase } from "./database.ts";

/** An open binding, what to tell the person about it, and how to close it. */
export interface OpenBinding {
  /** The `D1Database` binding, as a Worker would have it as `env.DB`. */
  binding: unknown;
  description: string;
  dispose: () => Promise<void>;
}

interface Wrangler {
  getPlatformProxy: (options: {
    configPath: string;
    persist: { path: string };
    remoteBindings: boolean;
  }) => Promise<{ env: Record<string, unknown>; dispose: () => Promise<void> }>;
}

/**
 * The chosen binding on the project's local D1, in the `.wrangler/state` beside the config that
 * `wrangler dev` and `wrangler d1 migrations apply --local` use (`getPlatformProxy`'s own default
 * is relative to the working directory, which can be anywhere). `remoteBindings: false` keeps it
 * local even for a binding the config marks `remote: true`, which Wrangler would otherwise use.
 */
export async function openLocalBinding(
  cwd: string,
  { binding, configFile }: ChosenDatabase,
): Promise<OpenBinding | string> {
  let file: string;
  try {
    file = createJiti(`${cwd}/`).esmResolve("wrangler");
  } catch {
    return "wrangler isn't installed here (install it, then run d1-record console again)";
  }
  let wrangler: Wrangler;
  try {
    wrangler = (await import(file)) as Wrangler;
  } catch (error) {
    return `Couldn't load wrangler: ${(error as Error).message}`;
  }
  let proxy: Awaited<ReturnType<Wrangler["getPlatformProxy"]>>;
  try {
    proxy = await wrangler.getPlatformProxy({
      configPath: configFile,
      persist: { path: join(dirname(configFile), ".wrangler/state/v3") },
      remoteBindings: false,
    });
  } catch (error) {
    return `Wrangler couldn't open ${binding}: ${(error as Error).message}`;
  }
  return {
    binding: proxy.env[binding],
    description: `Local database ${binding} (.wrangler/state)`,
    dispose: proxy.dispose,
  };
}
