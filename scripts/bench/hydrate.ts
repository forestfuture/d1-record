// How fast records are made: hydrating rows directly, and loading them from a real D1 through
// Miniflare. Not part of CI; run with `vp run bench:hydrate` to compare before and after a change
// to how records are built. Prints the median of several runs after a warm-up.
import { Miniflare } from "miniflare";
import { connect } from "../../src/index.ts";
import { Executor } from "../../src/executor.ts";
import { hydrate } from "../../src/model.ts";
import { Author, schema } from "./models.ts";

const ROWS = 10_000;
const RUNS = 15;

function median(times: number[]): number {
  const sorted = [...times].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

async function measure(label: string, run: () => unknown): Promise<void> {
  for (let warm = 0; warm < 3; warm++) await run();
  const times: number[] = [];
  for (let index = 0; index < RUNS; index++) {
    const started = performance.now();
    await run();
    times.push(performance.now() - started);
  }
  const ms = median(times);
  console.log(`${label}: ${ms.toFixed(1)} ms (${((ms / ROWS) * 1000).toFixed(2)} µs per record)`);
}

const rows = Array.from({ length: ROWS }, (_, index) => ({
  id: `author-${index}`,
  name: `Author ${index}`,
  publisher_id: null,
  created_at: "2026-01-01T00:00:00.000Z",
}));
const executor = new Executor({} as never);
await measure(`hydrate ${ROWS} records`, () => {
  for (const row of rows) hydrate(Author, row, executor);
});

const mf = new Miniflare({ modules: true, script: "export default {}", d1Databases: ["DB"] });
const binding = await mf.getD1Database("DB");
await binding.exec(schema.replaceAll("\n", " "));
for (let start = 0; start < ROWS; start += 500) {
  await binding.batch(
    rows
      .slice(start, start + 500)
      .map((row) =>
        binding
          .prepare("INSERT INTO authors (id, name, created_at) VALUES (?, ?, ?)")
          .bind(row.id, row.name, row.created_at),
      ),
  );
}
const db = connect(binding as never);
await measure(`toArray() of ${ROWS} rows from D1`, () => db.model(Author).toArray());
await mf.dispose();
