import { underscore } from "../../src/naming.ts";

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
  return `${underscore(className).replaceAll("_", "-")}.ts`;
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
      imports.push(`import { ${className} } from "./${modelFileName(className).slice(0, -3)}";`);
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

/** A models file with one more Model at its end (`--models src/models.ts`). */
export function appendModel(existing: string, model: ModelToWrite): string {
  if (existing.trim() === "") return modelSource(model, { separateFiles: false });
  const source = model.associations.length > 0 ? importingBelongsTo(existing) : existing;
  return `${source.trimEnd()}\n\n${classSource(model)}`;
}
