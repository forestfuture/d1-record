// How many inputs the property tests generate, shared so the budgets are set in one place (#122).

/** Pure functions and in-memory records: a thousand inputs take well under a second. */
export const PURE_RUNS = { numRuns: 1000 };

/** Anything slower: a real D1, SQL parsing, or long inputs. A hundred take a second or so. */
export const SLOW_RUNS = { numRuns: 100 };

/** A hundred D1 runs take about a second alone, and several times that beside other suites. */
export const SLOW_TIMEOUT = 30_000;
