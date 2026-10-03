import { readdirSync, readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, expectTypeOf, test } from "vite-plus/test";
import { runSchema } from "../../cli/schema/command.ts";
import { belongsTo, connect, Model } from "../../src/index.ts";
import { products, users } from "../fixtures/schema-project/schema.ts";

const projectDir = new URL("../fixtures/schema-project/", import.meta.url).pathname;

// Models built from the generated specs, as a project would before #69's Model("products").
class User extends Model(users) {
  static tableName = "users";
}
class Product extends Model(products) {
  static tableName = "products";
  user = belongsTo(User);
}

describe("a schema generated from migrations", () => {
  let mf: Miniflare;
  let binding: Awaited<ReturnType<Miniflare["getD1Database"]>>;

  beforeAll(async () => {
    mf = new Miniflare({ modules: true, script: "export default {}", d1Databases: ["DB"] });
    binding = await mf.getD1Database("DB");
    for (const file of readdirSync(`${projectDir}migrations`).sort()) {
      await binding.exec(
        readFileSync(`${projectDir}migrations/${file}`, "utf8").replaceAll("\n", " "),
      );
    }
  });
  afterAll(() => mf.dispose());

  test("is current: the committed schema.ts is what its migrations generate", () => {
    const output: string[] = [];

    expect(
      runSchema({ cwd: projectDir, out: "schema.ts", check: true }, (line) => output.push(line)),
    ).toBe(0);
  });

  test("types each attribute from its column", () => {
    expectTypeOf<Product["id"]>().toEqualTypeOf<string>();
    expectTypeOf<Product["priceCents"]>().toEqualTypeOf<number>();
    expectTypeOf<Product["rating"]>().toEqualTypeOf<number | null>();
    expectTypeOf<Product["available"]>().toEqualTypeOf<boolean>();
    expectTypeOf<Product["releasedOn"]>().toEqualTypeOf<Date | null>();
    expectTypeOf<Product["tagline"]>().toEqualTypeOf<string | null>();
  });

  test("a Model built from it round-trips every type against D1, defaults included", async () => {
    const db = connect(binding);
    const user = await db.model(User).createOrThrow({ email: "ada@example.com" });
    const built = db.model(Product).build({ userId: user.id, name: "Lamp", priceCents: 4500 });

    // Generated defaults show on a new record, as Rails' column defaults do.
    expect([built.available, built.tagline, typeof built.id]).toEqual([true, "New!", "string"]);
    await built.update({
      rating: 4.5,
      settings: { colour: "brass", sizes: [1, 2] },
      releasedOn: new Date("2026-01-02T00:00:00.000Z"),
    });

    const read = await db.model(Product).find(built.id);
    expect(read.attributes()).toEqual({
      id: built.id,
      userId: user.id,
      name: "Lamp",
      priceCents: 4500,
      rating: 4.5,
      available: true,
      settings: { colour: "brass", sizes: [1, 2] },
      releasedOn: new Date("2026-01-02T00:00:00.000Z"),
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date),
      tagline: "New!",
    });
    expect((await read.user())?.isAdmin).toBe(false);
  });
});
