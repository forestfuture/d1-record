// Copies the documentation site's llms-full.txt into the package root, so the published package
// carries the guide for its own version (node_modules/@forestfuture/d1-record/llms-full.txt).
// Runs from `prepack`, after `vp run docs:build`.
import { copyFileSync } from "node:fs";

copyFileSync(
  new URL("../site/dist/llms-full.txt", import.meta.url),
  new URL("../llms-full.txt", import.meta.url),
);
