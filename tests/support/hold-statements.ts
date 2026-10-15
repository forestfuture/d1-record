// Holding a D1 statement open until released, to land a read or write in a chosen order.
import { connect } from "../../src/index.ts";
import type { TestDatabase } from "./d1.ts";

/** Whether a statement reads `table`: what to hold to land a read after something else. */
export const reads = (table: string) => (sql: string) =>
  sql.startsWith("SELECT") && sql.includes(`"${table}"`);

/** A held statement waits for `release()` before it reaches D1, or after D1 has answered it. */
type Hold = "beforeRunning" | "afterRunning";

/**
 * D1 that, once armed, holds each statement whose SQL `matches` until released: ordered, not
 * timed, so whatever runs meanwhile always lands first. `held` resolves when one is held.
 */
export function holdStatements(
  binding: TestDatabase,
  matches: (sql: string) => boolean,
  hold: Hold,
): { db: ReturnType<typeof connect>; arm: () => void; held: Promise<void>; release: () => void } {
  type Prepared = ReturnType<TestDatabase["prepare"]>;
  let armed = false;
  let isHeld!: () => void;
  let release!: () => void;
  const held = new Promise<void>((resolve) => (isHeld = resolve));
  const released = new Promise<void>((resolve) => (release = resolve));
  const holding = (statement: Prepared): Prepared =>
    new Proxy(statement, {
      get(inner, name) {
        if (name === "bind") return (...values: unknown[]) => holding(inner.bind(...values));
        if (name !== "all") return Reflect.get(inner, name, inner);
        return async () => {
          const result = hold === "afterRunning" ? await inner.all() : undefined;
          isHeld();
          await released;
          return result ?? inner.all();
        };
      },
    });
  const proxy = new Proxy(binding, {
    get(target, property) {
      if (property !== "prepare") return Reflect.get(target, property, target);
      return (query: string) => {
        const statement = target.prepare(query);
        return armed && matches(query) ? holding(statement) : statement;
      };
    },
  });
  return { db: connect(proxy as never), arm: () => (armed = true), held, release };
}
