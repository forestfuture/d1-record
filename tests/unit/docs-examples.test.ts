import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { exampleBlock, site } from "../../site/.vitepress/examples.ts";

// The guide's examples come from type-checked files; each is shown with the imports it uses.
describe("the guide's example blocks", () => {
  const file = join(mkdtempSync(join(tmpdir(), "examples-")), "example.ts");
  writeFileSync(
    file,
    `import { belongsTo, connect, hasMany, Model, type Database } from "@forestfuture/d1-record";
import { User } from "../shared/users";
import { Tag } from "./tags";
import { tables } from "../db/schema";

// #region declare
export class Post extends Model({ id: "integer" }) {
  author = belongsTo(User);
  tags = hasMany(Tag);
}
// #endregion declare

// #region schema
export const shown = tables;
// #endregion schema

export async function read(db: Database) {
  // #region read
  const posts = await db.model(Post).toArray();
  // #endregion read
  return posts;
}
`,
  );

  test("the generated schema is imported as written, not as one of the app's models", () => {
    expect(exampleBlock(file, "schema")).toBe(`import { tables } from "../db/schema";

export const shown = tables;`);
  });

  test("start with the imports their code uses, and only those; the app's models come from ./models", () => {
    expect(exampleBlock(file, "declare"))
      .toBe(`import { belongsTo, hasMany, Model } from "@forestfuture/d1-record";
import { User, Tag } from "./models";

export class Post extends Model({ id: "integer" }) {
  author = belongsTo(User);
  tags = hasMany(Tag);
}`);
  });

  test("are dedented, and have no imports when their code uses none", () => {
    expect(exampleBlock(file, "read")).toBe("const posts = await db.model(Post).toArray();");
  });

  test("every region a guide page includes exists", () => {
    const pages = readdirSync(join(site, "guide")).filter((name) => name.endsWith(".md"));
    const includes = pages.flatMap((page) =>
      [
        ...readFileSync(join(site, "guide", page), "utf8").matchAll(
          /^<<< @\/(\S+?\.ts)#([\w-]+)\{/gm,
        ),
      ].map(([, path, region]) => ({ page, path: path!, region: region! })),
    );

    expect(includes.length).toBeGreaterThan(20);
    for (const { page, path, region } of includes) {
      expect(exampleBlock(join(site, path), region), `${page}: ${path}#${region}`).toBeDefined();
    }
  });

  test("an example written inline in a page imports whatever it uses from the package", () => {
    const index = readFileSync(new URL("../../src/index.ts", import.meta.url), "utf8");
    const exported = [...index.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)].flatMap(([, list]) =>
      list!.split(",").map((name) =>
        name
          .replace(/\btype\s+/, "")
          .split(" as ")
          .pop()!
          .trim(),
      ),
    );
    const pages = readdirSync(join(site, "guide")).filter((name) => name.endsWith(".md"));
    const unimported = pages.flatMap((page) =>
      [
        ...readFileSync(join(site, "guide", page), "utf8").matchAll(/```ts[^\n]*\n([\s\S]*?)```/g),
      ].flatMap(([, code]) =>
        exported
          // A bare name, not a property such as `binding.batch`.
          .filter((name) => name && new RegExp(`(?<![.\\w])${name}\\b`).test(code!))
          .filter((name) => !new RegExp(`import[^;]*\\b${name}\\b`).test(code!))
          .map((name) => `${page}: ${name}`),
      ),
    );

    expect(unimported).toEqual([]);
  });
});
