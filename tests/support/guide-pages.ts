import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The guide's pages as written: every Markdown or MDX file under site/docs but the generated
// excerpts, named by their path there, such as `(basics)/models.mdx`.

const docs = join(import.meta.dirname, "../../site/docs");

export interface GuidePage {
  name: string;
  text: string;
}

export function guidePages(): GuidePage[] {
  return readdirSync(docs, { recursive: true, encoding: "utf8" })
    .filter((name) => /\.mdx?$/.test(name) && !name.startsWith("_"))
    .map((name) => ({ name, text: readFileSync(join(docs, name), "utf8") }));
}
