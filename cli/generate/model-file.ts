import { moduleName } from "./names.ts";

/** A Model to write: its class, its table, and the `belongsTo`s its references suggest. */
export interface ModelToWrite {
  className: string;
  table: string;
  associations: readonly { name: string; className: string }[];
  /** The generated schema, as the Model's file imports it (`../db/schema`). */
  schemaImport: string;
}

const library = "@forestfuture/d1-record";

/** A Model's file name: its class name in kebab-case (`LineItem` → `line-item.ts`). */
export function modelFileName(className: string): string {
  return `${moduleName(className)}.ts`;
}

/** The class itself: `export class LineItem extends Model("line_items") { … }`. */
function classSource({ className, table, associations }: ModelToWrite): string {
  const head = `export class ${className} extends Model(${JSON.stringify(table)})`;
  if (associations.length === 0) return `${head} {}\n`;
  const fields = associations.map(
    ({ name, className: target }) => `  ${name} = belongsTo(${target});\n`,
  );
  return `${head} {\n${fields.join("")}}\n`;
}

/**
 * A Model's source, with its imports: the library's `belongsTo` when it has one, the schema's
 * `Model`, and, in a file of its own, each target's file (`./order`), as Rails assumes it exists.
 */
export function modelSource(
  model: ModelToWrite,
  { separateFiles }: { separateFiles: boolean },
): string {
  const imports: string[] = [];
  if (model.associations.length > 0) imports.push(`import { belongsTo } from "${library}";`);
  imports.push(`import { Model } from "${model.schemaImport}";`);
  if (separateFiles) {
    for (const { className } of model.associations) {
      imports.push(`import { ${className} } from "./${moduleName(className)}";`);
    }
  }
  return `${imports.join("\n")}\n\n${classSource(model)}`;
}

/** `source` with `belongsTo` among its imports from the library, adding the import if it has none. */
function importingBelongsTo(source: string): string {
  const existing = new RegExp(`^import \\{([^}]*)\\} from "${library}";$`, "m");
  const match = existing.exec(source);
  if (match === null) return `import { belongsTo } from "${library}";\n${source}`;
  const names = match[1]!
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.includes("belongsTo")) return source;
  const sorted = [...names, "belongsTo"].sort();
  return source.replace(existing, `import { ${sorted.join(", ")} } from "${library}";`);
}

/**
 * `source` importing `Model` from the schema, adding the import if it has none; or why not, when
 * it imports another database's `Model`.
 */
function importingModel(
  source: string,
  schemaImport: string,
): { ok: true; source: string } | { ok: false; error: string } {
  const existing = /^import \{[^}]*\bModel\b[^}]*\} from "([^"]+)";$/m.exec(source);
  if (existing === null)
    return { ok: true, source: `import { Model } from "${schemaImport}";\n${source}` };
  return existing[1] === schemaImport
    ? { ok: true, source }
    : {
        ok: false,
        error: `it imports Model from ${existing[1]}, not ${schemaImport}; keep each database's Models in their own file`,
      };
}

/** A models file with one more Model at its end (`--models src/models.ts`), or why it can't be. */
export function appendModel(
  existing: string,
  model: ModelToWrite,
): { ok: true; source: string } | { ok: false; error: string } {
  if (existing.trim() === "")
    return { ok: true, source: modelSource(model, { separateFiles: false }) };
  const imported = importingModel(existing, model.schemaImport);
  if (!imported.ok) return imported;
  const source =
    model.associations.length > 0 ? importingBelongsTo(imported.source) : imported.source;
  return { ok: true, source: `${source.trimEnd()}\n\n${classSource(model)}` };
}
