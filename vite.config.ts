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
    // TODO(#1): remove once the first unit tests land.
    passWithNoTests: true,
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
  },
  fmt: {
    // The original design brief is kept verbatim.
    ignorePatterns: ["docs/brief.md"],
  },
});
