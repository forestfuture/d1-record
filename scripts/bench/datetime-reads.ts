// CPU of hydrating rows with none, one or two stored datetimes (#216), in-process, no D1.
// Not part of CI; run with `vp run bench:datetime-reads` before and after a change to how
// datetimes are read.
import { D1Executor } from "../../src/executor.ts";
import { Model } from "../../src/index.ts";
import { hydrate } from "../../src/model.ts";

const ROWS = 10_000;
const RUNS = 40;

class NoDates extends Model({
  id: { type: "string", null: false },
  name: "string",
  a: "string",
  b: "string",
}) {}
class OneDate extends Model({
  id: { type: "string", null: false },
  name: "string",
  a: "string",
  createdAt: "datetime",
}) {}
class TwoDates extends Model({
  id: { type: "string", null: false },
  name: "string",
  createdAt: "datetime",
  updatedAt: "datetime",
}) {}

const at = (i: number) => new Date(Date.UTC(2020, 0, 1) + i * 7_777_777).toISOString();
const rows = Array.from({ length: ROWS }, (_, i) => ({
  id: `r${i}`,
  name: `Name ${i}`,
  a: "x",
  b: "y",
  created_at: at(i),
  updated_at: at(i + 1),
}));
const executor = new D1Executor({} as never);

function measure(label: string, model: typeof NoDates | typeof OneDate | typeof TwoDates) {
  const run = () => {
    for (const row of rows) hydrate(model as never, row, executor);
  };
  for (let warm = 0; warm < 5; warm++) run();
  const started = performance.now();
  for (let index = 0; index < RUNS; index++) run();
  const us = ((performance.now() - started) / RUNS / ROWS) * 1000;
  console.log(`${label.padEnd(20)} ${us.toFixed(2)} µs/row`);
}

measure("no datetime", NoDates);
measure("one datetime", OneDate);
measure("two datetimes", TwoDates);
