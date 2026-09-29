// Fails if the published type declarations expose library internals. Run after `vp pack`.
import { readFileSync } from "node:fs";

const INTERNAL = [
  "OwnedCollection",
  "OwnerLink",
  "AssociationCache",
  "QueryDescription",
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
const leaked = INTERNAL.filter((name) => new RegExp(`\\b${name}\\b`).test(declarations));
if (leaked.length > 0) {
  console.error(`dist/index.d.mts exposes internals: ${leaked.join(", ")}`);
  process.exit(1);
}
console.log("dist/index.d.mts exposes no internals");
