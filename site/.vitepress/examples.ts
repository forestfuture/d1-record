import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** The part of a Vite plugin this needs (the site package doesn't depend on Vite directly). */
interface Plugin {
  name: string;
  enforce: "pre";
  transform(
    this: { addWatchFile(file: string): void },
    code: string,
    id: string,
  ): { code: string; map: null } | null;
}

/** An import statement, split into its names so each example shows only the ones it uses. */
interface Import {
  source: string;
  names: string[]; // as written: `hasMany`, `type Database`, `* as d1`, a default import
}

const importPattern = /^import\s+(type\s+)?([\s\S]*?)\s+from\s+(["'][^"']+["']);?\s*$/gm;

function importsOf(code: string): Import[] {
  return [...code.matchAll(importPattern)].map(([, typeOnly = "", clause, source]) => {
    const prefix = typeOnly ? "type " : "";
    const braces = /\{([\s\S]*)\}/.exec(clause!);
    const named =
      braces?.[1]
        ?.split(",")
        .map((name) => name.trim())
        .filter(Boolean) ?? [];
    const bare = clause!
      .replace(/\{[\s\S]*\}/, "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    return { source: source!, names: [...bare, ...named].map((name) => prefix + name) };
  });
}

/** The binding a name introduces: `type Database` → Database, `* as d1` → d1. */
function bindingOf(name: string): string {
  return name
    .replace(/^type\s+/, "")
    .split(/\s+as\s+/)
    .pop()!
    .replace(/^\*\s*/, "");
}

/** The lines between `// #region name` and `// #endregion name`, every part of it, dedented. */
function regionOf(code: string, name: string): string | undefined {
  const parts: string[] = [];
  const pattern = new RegExp(
    `^[ \\t]*// #region ${name}\\n([\\s\\S]*?)^[ \\t]*// #endregion ${name}$`,
    "gm",
  );
  for (const [, body] of code.matchAll(pattern)) parts.push(dedent(body!.replace(/\n$/, "")));
  return parts.length === 0 ? undefined : parts.join("\n\n");
}

function dedent(text: string): string {
  const lines = text.split("\n");
  const indent = Math.min(
    ...lines.filter((line) => line.trim()).map((line) => /^\s*/.exec(line)![0].length),
  );
  return lines.map((line) => line.slice(indent)).join("\n");
}

/** Code without its line comments and quoted strings, so only real uses of a name count. */
function codeOnly(code: string): string {
  return code.replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|\/\/.*$/gm, "");
}

/** Where an import is shown from: the app's base class, its schema, or its models. */
function shownSource(source: string): string {
  if (!/^["']\./.test(source)) return source;
  if (/\/schema["']$/.test(source)) return source;
  if (/\/application-record["']$/.test(source)) return '"./application-record"';
  return '"./models"';
}

/**
 * An example as shown: the snippet file's imports that the region uses, then the region. So
 * every example says where its names come from, and both come from the type-checked file.
 * The snippets' own model files (any relative import) are shown as the app's: `./models`. The
 * generated schema (`../db/schema`) and the app's base class (`./application-record`) are
 * shown where an app imports them from.
 */
export function exampleBlock(file: string, region: string): string | undefined {
  const code = readFileSync(file, "utf8").replaceAll("\r\n", "\n");
  const body = regionOf(code, region);
  if (body === undefined) return undefined;
  const uses = codeOnly(body);
  const used = (name: string) => new RegExp(`\\b${bindingOf(name)}\\b`).test(uses);
  const bySource = new Map<string, string[]>();
  for (const { source, names } of importsOf(code)) {
    const shown = shownSource(source);
    bySource.set(shown, [...(bySource.get(shown) ?? []), ...names.filter(used)]);
  }
  const imports = [...bySource]
    .filter(([, names]) => names.length > 0)
    .map(([source, names]) => `import { ${names.join(", ")} } from ${source};`);
  return imports.length === 0 ? body : `${imports.join("\n")}\n\n${body}`;
}

// TypeScript examples only; other includes (such as SKILL.md's rules) are VitePress's own.
const includePattern = /^<<< @\/(\S+?\.ts)#([\w-]+)\{(\w+)\}(.*)$/gm;

/**
 * Expands `<<< @/snippets/file.ts#region{ts}` in the guide's pages into a code block with its
 * imports, before VitePress and the llms plugin read the page, so both show the same example.
 */
export function examples(siteDir: string): Plugin {
  return {
    name: "d1-record:examples",
    enforce: "pre",
    transform(markdown, id) {
      if (!id.endsWith(".md")) return null;
      let changed = false;
      const expanded = markdown.replace(includePattern, (include, ...groups: string[]) => {
        const [path, region, lang, meta] = groups as [string, string, string, string];
        const file = join(siteDir, path);
        const block = exampleBlock(file, region);
        if (block === undefined) return include; // VitePress reports a missing region itself
        this.addWatchFile(file);
        changed = true;
        return `\`\`\`${lang}${meta}\n${block}\n\`\`\``;
      });
      return changed ? { code: expanded, map: null } : null;
    },
  };
}

export const site = dirname(dirname(new URL(import.meta.url).pathname));
