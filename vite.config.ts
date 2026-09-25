import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  pack: {
    target: "es2022",
    tsconfig: "src/tsconfig.json",
    dts: {
      generator: "tsgo",
    },
    exports: true,
    // ESM-only package for Workers: skip node10/CommonJS resolution checks.
    attw: { profile: "esm-only" },
    publint: true,
  },
  test: {
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"] },
      },
      {
        // Real D1 via Miniflare, running in Node (see ADR-0002).
        extends: true,
        test: { name: "integration", include: ["tests/integration/**/*.test.ts"] },
      },
    ],
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
    // Size and complexity limits: small, understandable internals (brief, principle 5).
    rules: {
      complexity: ["error", { max: 10 }],
      "max-depth": ["error", { max: 3 }],
      "max-params": ["error", { max: 4 }],
      "max-lines-per-function": ["error", { max: 60, skipBlankLines: true, skipComments: true }],
    },
    overrides: [
      {
        // A describe() callback holds a whole suite, so it's long by design.
        files: ["tests/**"],
        rules: { "max-lines-per-function": "off" },
      },
    ],
  },
  fmt: {
    // The original design brief is kept verbatim.
    ignorePatterns: ["docs/brief.md"],
  },
});
