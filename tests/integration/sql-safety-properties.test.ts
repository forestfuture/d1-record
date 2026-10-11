import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { connect, Model, sql, type QueryEvent } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

class Sample extends Model({ id: { type: "integer", null: false }, label: "string" }) {
  static tableName = "samples";
  // These tests read bound values, so nothing is filtered (#83).
  static override filterAttributes = [];
}

// The characters SQL and its comments, quoting and patterns are made of, plus ones that are
// awkward in a string (a NUL, a newline, accented and astral letters). Lone surrogates aren't
// here: SQLite stores UTF-8, so what comes back isn't the lone half the app sent, and that's
// not something the library controls.
const sqlCharacters = fc.constantFrom(
  "'",
  '"',
  "`",
  ";",
  "-",
  "/",
  "*",
  "\\",
  "%",
  "_",
  "?",
  ":",
  "$",
  "(",
  ")",
  "=",
  " ",
  "\n",
  "\t",
  "\u0000",
  "a",
  "Z",
  "0",
  "é",
  "😀",
);
const fragments = fc.constantFrom(
  "' OR 1 = 1 --",
  "'; DROP TABLE samples; --",
  '" OR ""="',
  "x' UNION SELECT 1, 'y",
  "%",
);
const texts = fc.oneof(
  fc.string({ unit: sqlCharacters, maxLength: 24 }),
  fc.tuple(fc.string({ unit: sqlCharacters, maxLength: 6 }), fragments).map((p) => p.join("")),
);

// Each run starts a fresh table and queries a real D1: a hundred runs per property (#122).
const runs = { numRuns: 100 };

/** Stored labels, and a needle that is one of them half the time, so a match is common. */
const scenarios = fc
  .record({
    labels: fc.array(texts, { maxLength: 5 }),
    pick: fc.nat(),
    other: texts,
    fromLabels: fc.boolean(),
  })
  .map(({ labels, pick, other, fromLabels }) => ({
    labels,
    needle: fromLabels && labels.length > 0 ? labels[pick % labels.length]! : other,
  }));

/** The ids a database holding `labels` (ids from 1) should give for an exact match. */
function matching(labels: string[], needle: string): number[] {
  return labels.flatMap((label, index) => (label === needle ? [index + 1] : []));
}

// A hundred queries take about a second alone, and several times that beside the other suites.
const TIMEOUT = 30_000;

describe("a text value of any content, in a query", { timeout: TIMEOUT }, () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  const queries: QueryEvent[] = [];
  const samples = () => connect(binding, { onQuery: (event) => queries.push(event) }).model(Sample);

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());

  /** Replaces the table's rows with `labels`, then returns the ids of rows with this label. */
  async function idsFor(labels: string[], run: (relation: ReturnType<typeof samples>) => unknown) {
    await binding.prepare("DELETE FROM samples").run();
    const inserts = labels.map((label, index) =>
      binding.prepare("INSERT INTO samples (id, label) VALUES (?, ?)").bind(index + 1, label),
    );
    // D1 refuses an empty batch.
    if (inserts.length > 0) await binding.batch(inserts);
    queries.length = 0;
    const rows = (await run(samples())) as Sample[];
    return {
      ids: rows.map((row) => row.id).sort((a, b) => a - b),
      sql: queries.map((query) => query.sql),
    };
  }

  /** The statement text for a plain, harmless value: every other value must give the same. */
  async function plainStatement(): Promise<string[]> {
    const { sql: statement } = await idsFor(["x"], (s) => s.where({ label: "x" }).toArray());
    return statement;
  }

  test("is bound: the statement is the same, and the rows are those an exact match gives", async () => {
    const plain = await plainStatement();

    await fc.assert(
      fc.asyncProperty(scenarios, async ({ labels, needle }) => {
        const found = await idsFor(labels, (s) => s.where({ label: needle }).toArray());

        expect(found.sql).toEqual(plain);
        expect(found.ids).toEqual(matching(labels, needle));
      }),
      runs,
    );
  });

  test("is bound when interpolated into an sql fragment too", async () => {
    const { sql: plain } = await idsFor(["x"], (s) => s.where(sql`label = ${"x"}`).toArray());

    await fc.assert(
      fc.asyncProperty(scenarios, async ({ labels, needle }) => {
        const found = await idsFor(labels, (s) => s.where(sql`label = ${needle}`).toArray());

        expect(found.sql).toEqual(plain);
        expect(found.ids).toEqual(matching(labels, needle));
      }),
      runs,
    );
  });

  test("is stored and read back as it was, and its statement is the same", async () => {
    await binding.prepare("DELETE FROM samples").run();
    queries.length = 0;
    await samples().create({ label: "x" });
    const plain = queries.map((query) => query.sql).filter((text) => text.startsWith("INSERT"));

    await fc.assert(
      fc.asyncProperty(texts, async (label) => {
        queries.length = 0;
        const created = await samples().create({ label });
        const reloaded = await samples().find(created.id);

        expect(reloaded.label).toBe(label);
        expect(
          queries.map((query) => query.sql).filter((text) => text.startsWith("INSERT")),
        ).toEqual(plain);
      }),
      runs,
    );
  });
});
