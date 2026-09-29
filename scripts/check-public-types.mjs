// Fails if the published type declarations expose library internals. Run after `vp pack`.
// Internals are marked `/** @internal */` and stripped (stripInternal in src/tsconfig.json).
import { readFileSync } from "node:fs";

/** Internal names that must never appear in the published types. */
const INTERNAL = [
  "OwnedCollection",
  "ResolvedAssociation",
  "resolveAssociation",
  "linkOf",
  "prepareModel",
  "QueryDescription",
  "RelationParts",
  "ofOwner",
  "applyScope",
  "requirePreloadable",
  "statementParts",
  "recordStatementParts",
  "comparisonParts",
  "RecordState",
  "CachedAssociation",
  "Executor",
  "CompiledSql",
  "clearErrors",
];

const declarations = readFileSync(new URL("../dist/index.d.mts", import.meta.url), "utf8");
const problems = INTERNAL.filter((name) => new RegExp(`\\b${name}\\b`).test(declarations));

// Relations come from db.model() and other Relations: no public constructor.
const relation = /declare class Relation<[\s\S]*?\n\}/.exec(declarations)?.[0] ?? "";
if (/^\s*constructor\(/m.test(relation)) problems.push("a public Relation constructor");

if (problems.length > 0) {
  console.error(`dist/index.d.mts exposes internals: ${problems.join(", ")}`);
  process.exit(1);
}
console.log("dist/index.d.mts exposes no internals");
