import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Miniflare } from "miniflare";
import { afterAll, describe, expect, test } from "vite-plus/test";
import { runGenerate } from "../../cli/generate/command.ts";
import { connect } from "../../src/index.ts";

// Inside tests/ (gitignored), so a generated project's imports of the library resolve as they
// do in the repo, through tsconfig.json's paths.
const scratch = new URL("../.scratch/", import.meta.url).pathname;

/** A throwaway project with a Wrangler config: its files, by path. */
function project(files: Record<string, string> = {}): string {
  mkdirSync(scratch, { recursive: true });
  const dir = mkdtempSync(join(scratch, "generate-"));
  const all = {
    "wrangler.jsonc": '{ "d1_databases": [{ "binding": "DB", "database_name": "shop-db" }] }',
    ...files,
  };
  for (const [path, content] of Object.entries(all)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

/** Runs a generator (`g model …` or `g migration …`), collecting what it prints. */
function generate(
  cwd: string,
  args: string[],
  options: Partial<Parameters<typeof runGenerate>[0]> = {},
) {
  const [kind, name, ...columns] = args as ["model" | "migration", string, ...string[]];
  const output: string[] = [];
  const code = runGenerate({ cwd, kind, name, columns, ...options }, (line) => output.push(line));
  return { code, output: output.join("\n") };
}

/** A generated Model file's classes, loaded as an app would import them (typed loosely). */
async function modelsIn(cwd: string, path: string) {
  const models: Record<string, any> = await import(join(cwd, path));
  return models;
}

const read = (cwd: string, path: string) => readFileSync(join(cwd, path), "utf8");

describe("d1-record g model", () => {
  test("writes a migration and a Model, regenerates the schema, and says what's next", () => {
    const cwd = project();

    const { code, output } = generate(cwd, [
      "model",
      "Product",
      "name:string!",
      "priceCents:integer!=0",
    ]);

    expect(code).toBe(0);
    expect(output).toBe(`Wrote migrations/0001_create_products.sql
Wrote src/models/product.ts
Wrote src/db/schema.ts (1 table) from migrations/
Next: npx wrangler d1 migrations apply shop-db --local`);
    expect(read(cwd, "src/models/product.ts")).toBe(`import { Model } from "../db/schema";

export class Product extends Model("products") {}
`);
    expect(read(cwd, "src/db/schema.ts")).toContain(
      '  priceCents: { type: "integer", null: false, default: () => 0 },',
    );
  });

  test("a reference takes its table's key type, and its belongsTo imports the target's file", () => {
    const cwd = project();
    generate(cwd, ["model", "Order", "total:integer"], { integerId: true });

    const { code } = generate(cwd, [
      "model",
      "LineItem",
      "order:references",
      "quantity:integer!=1",
    ]);

    expect(code).toBe(0);
    expect(read(cwd, "migrations/0002_create_line_items.sql")).toContain(
      "order_id INTEGER NOT NULL REFERENCES orders (id)",
    );
    expect(read(cwd, "src/models/line-item.ts"))
      .toBe(`import { belongsTo } from "@forestfuture/d1-record";
import { Model } from "../db/schema";
import { Order } from "./order";

export class LineItem extends Model("line_items") {
  order = belongsTo(Order);
}
`);
  });

  test("--models appends to one file", () => {
    const cwd = project();
    generate(cwd, ["model", "User", "email:string!:unique"], { models: "src/models.ts" });

    generate(cwd, ["model", "Post", "user:references"], { models: "src/models.ts" });

    expect(read(cwd, "src/models.ts")).toBe(`import { belongsTo } from "@forestfuture/d1-record";
import { Model } from "./db/schema";

export class User extends Model("users") {}

export class Post extends Model("posts") {
  user = belongsTo(User);
}
`);
  });

  test("refuses, writing nothing, when the table or the Model file already exists", () => {
    const cwd = project();
    generate(cwd, ["model", "Product"]);

    expect(generate(cwd, ["model", "Product"])).toEqual({
      code: 1,
      output: "src/models/product.ts already exists\nWrote nothing",
    });
    expect(generate(cwd, ["model", "Product"], { models: "src/other" })).toEqual({
      code: 1,
      output: expect.stringMatching(
        /^0002_create_products\.sql: .*table products already exists\nWrote nothing$/,
      ),
    });
    expect(readdirSync(join(cwd, "migrations"))).toEqual(["0001_create_products.sql"]);
  });
});

describe("d1-record g migration", () => {
  test("adds and removes columns, numbering after the existing migrations", () => {
    const cwd = project({
      "migrations/0007_create_products.sql": "CREATE TABLE products (id TEXT PRIMARY KEY);",
    });

    const added = generate(cwd, [
      "migration",
      "AddSkuToProducts",
      "sku:string:unique",
      "active:boolean!=true",
    ]);
    const removed = generate(cwd, ["migration", "RemoveSkuFromProducts", "sku"]);

    expect(added.code).toBe(0);
    expect(added.output).toMatch(/^Wrote migrations\/0008_add_sku_to_products\.sql\n/);
    expect(removed.code).toBe(0);
    expect(read(cwd, "src/db/schema.ts")).toContain(
      "/** products — last changed by 0009_remove_sku_from_products.sql */",
    );
    expect(read(cwd, "src/db/schema.ts")).not.toContain("sku:");
  });

  test("an empty migration for any other name; a NOT NULL column without a default is refused", () => {
    const cwd = project({
      "migrations/0001_create_products.sql": "CREATE TABLE products (id TEXT PRIMARY KEY);",
    });

    expect(generate(cwd, ["migration", "BackfillPrices"]).code).toBe(0);
    expect(read(cwd, "migrations/0002_backfill_prices.sql")).toBe(
      "-- Write the migration's SQL here.\n",
    );
    expect(generate(cwd, ["migration", "AddSkuToProducts", "sku:string!"])).toEqual({
      code: 1,
      output:
        "products.sku: SQLite can't add a NOT NULL column without a default; give one (sku:string!=…) or leave out the !\nWrote nothing",
    });
  });

  test("several databases need --database, and a migrations_pattern the file wouldn't match is refused", () => {
    const two = project({
      "wrangler.jsonc":
        '{ "d1_databases": [{ "binding": "DB" }, { "binding": "LOGS", "migrations_dir": "logs" }] }',
    });
    const drizzle = project({
      "wrangler.jsonc":
        '{ "d1_databases": [{ "binding": "DB", "migrations_pattern": "migrations/*/migration.sql" }] }',
    });

    expect(generate(two, ["model", "Product"])).toEqual({
      code: 1,
      output: "This config has several D1 databases; choose one with --database (DB or LOGS)",
    });
    expect(generate(two, ["model", "Entry"], { database: "LOGS" }).output).toContain(
      "Wrote logs/0001_create_entries.sql\nWrote src/models/entry.ts\nWrote src/db/LOGS.ts",
    );
    expect(generate(drizzle, ["model", "Product"])).toEqual({
      code: 1,
      output:
        "migrations/0001_create_products.sql wouldn't match migrations_pattern (migrations/*/migration.sql), so Wrangler wouldn't apply it; write the migration with your migration tool instead",
    });
    expect(existsSync(join(drizzle, "migrations"))).toBe(false);
  });
});

describe("generated files against D1", () => {
  let mf: Miniflare | undefined;
  afterAll(() => mf?.dispose());

  test("the migrations apply to D1, and the Models create and find records through them", async () => {
    const cwd = project();
    generate(cwd, ["model", "User", "email:string!:unique", "admin:boolean!=false"]);
    generate(cwd, ["model", "Post", "user:references", "title:string!", "meta:json"]);
    generate(cwd, ["migration", "AddViewsToPosts", "views:integer!=0:index"]);
    mf = new Miniflare({ modules: true, script: "export default {}", d1Databases: ["DB"] });
    const binding = await mf.getD1Database("DB");
    for (const file of readdirSync(join(cwd, "migrations")).sort()) {
      await binding.exec(read(cwd, `migrations/${file}`).replaceAll("\n", " "));
    }
    const { User } = await modelsIn(cwd, "src/models/user.ts");
    const { Post } = await modelsIn(cwd, "src/models/post.ts");
    const db = connect(binding);

    const user = await db.model(User).createOrThrow({ email: "ada@example.com" });
    const post = await db
      .model(Post)
      .createOrThrow({ userId: user.id, title: "Hello", meta: { tags: ["a"] } });
    const found = await db.model(Post).find(post.id);

    expect([user.admin, found.views, found.meta, (await found.user())?.email]).toEqual([
      false,
      0,
      { tags: ["a"] },
      "ada@example.com",
    ]);
  });
});
