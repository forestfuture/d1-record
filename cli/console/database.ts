// Which D1 database the console opens: the only one in the Wrangler config, or the one named.
import { listed } from "../schema/names.ts";
import { readWranglerConfig } from "../schema/wrangler.ts";

/** The binding to open, and the Wrangler config file that declares it. */
export interface ChosenDatabase {
  binding: string;
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
  if (options.database !== undefined) {
    return bindings.includes(options.database)
      ? { binding: options.database, configFile: config.file }
      : `No D1 database is bound as ${options.database}; this config has ${listed(bindings)}`;
  }
  return bindings.length === 1
    ? { binding: bindings[0]!, configFile: config.file }
    : `This config has several D1 databases; choose one with --database (${listed(bindings)})`;
}
