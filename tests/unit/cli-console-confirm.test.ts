import { PassThrough } from "node:stream";
import { describe, expect, test } from "vite-plus/test";
import { confirmRemote } from "../../cli/console/confirm.ts";

/** Asks `confirmRemote` about a database, with this typed at it; what it printed, and its answer. */
async function asked(
  typed: string | undefined,
  target = { name: "shop", id: "1a2b3c" as string | undefined, preview: false },
) {
  const input = new PassThrough();
  const output = new PassThrough();
  let printed = "";
  output.on("data", (chunk: Buffer) => (printed += chunk.toString()));
  const answer = confirmRemote({ input, output, binding: "DB", target });
  if (typed === undefined) input.end();
  else input.write(`${typed}\n`);
  return { confirmed: await answer, printed };
}

// Before a remote session opens, the person says which database they mean (#104).
describe("confirming a remote database", () => {
  test("is confirmed by typing the database's name", async () => {
    expect((await asked("shop")).confirmed).toBe(true);
  });

  test("ignores spaces around the name", async () => {
    expect((await asked("  shop  ")).confirmed).toBe(true);
  });

  test("is not confirmed by anything else", async () => {
    for (const typed of ["y", "yes", "Shop", "shop-staging", ""]) {
      expect((await asked(typed)).confirmed, JSON.stringify(typed)).toBe(false);
    }
  });

  test("is not confirmed when the input ends without an answer", async () => {
    expect((await asked(undefined)).confirmed).toBe(false);
  });

  test("says which database, and that its data is real, before it asks", async () => {
    const { printed } = await asked("shop");

    expect(printed).toBe(
      "Remote database DB (shop, id 1a2b3c)\n" +
        "What you change in the console is changed in this database, not a copy.\n" +
        "Type its name to continue, anything else cancels: ",
    );
  });

  test("says when it is the preview database, and that the config chose it", async () => {
    const { printed } = await asked("shop", { name: "shop", id: "9z9z", preview: true });

    expect(printed).toBe(
      "Remote preview database DB (shop, id 9z9z)\n" +
        "That is the config's preview_database_id, which Wrangler opens in place of database_id.\n" +
        "What you change in the console is changed in this database, not a copy.\n" +
        "Type its name to continue, anything else cancels: ",
    );
  });
});
