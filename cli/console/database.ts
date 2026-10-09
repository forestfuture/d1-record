// Which D1 database the console opens: the only one in the Wrangler config, or the one named.
import { listed } from "../schema/names.ts";
import { readWranglerConfig } from "../schema/wrangler.ts";

/** The binding to open, and the Wrangler config file that declares it. */
export interface ChosenDatabase {
  binding: string;
  /** Its `d1_databases` entry, as the config has it. */
  entry: Record<string, unknown>;
  configFile: string;
}

/** The database for `--database` (and `--config`), or why there isn't one to open. */
export function databaseFor(
  cwd: string,
  options: { config?: string; database?: string },
): ChosenDatabase | string {
  const config = readWranglerConfig(cwd, options.config);
  if (!config.ok) return config.error;
  const bindings = config.databases.map((database) => database.binding);
  const chosen =
    options.database === undefined
      ? config.databases.length === 1
        ? config.databases[0]
        : undefined
      : config.databases.find((database) => database.binding === options.database);
  if (chosen !== undefined) {
    return { binding: chosen.binding, entry: chosen.entry, configFile: config.file };
  }
  return options.database === undefined
    ? `This config has several D1 databases; choose one with --database (${listed(bindings)})`
    : `No D1 database is bound as ${options.database}; this config has ${listed(bindings)}`;
}
