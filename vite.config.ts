import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  pack: [
    {
      target: "es2022",
      tsconfig: "src/tsconfig.json",
      // Provided by the Workers runtime; loaded only when a Model queries its binding (#77).
      external: ["cloudflare:workers"],
      // The two builds run together, so each cleans only its own files.
      clean: ["dist/index.*"],
      dts: {
        generator: "tsgo",
      },
      exports: true,
      // ESM-only package for Workers: skip node10/CommonJS resolution checks.
      attw: { profile: "esm-only" },
      publint: true,
    },
    {
      // The `d1-record` command (package.json's bin): Node only, never imported by a Worker.
      entry: { cli: "cli/bin.ts" },
      platform: "node",
      target: "node22",
      tsconfig: "cli/tsconfig.json",
      dts: false,
      clean: ["dist/cli.*"],
    },
  ],
  resolve: {
    // Resolves the package's own name to src/, from tsconfig.json's `paths` (one mapping for
    // TypeScript and tests), so the documentation's examples import it as an app would.
    tsconfigPaths: true,
  },
  test: {
    // `vp run coverage` fails when branch coverage of the library and command line drops below the
    // floor, and CI runs it (#121). The Best Practices `dynamic_analysis` criterion asks for 80%.
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "cli/**/*.ts"],
      reporter: ["text-summary"],
      thresholds: { branches: 90 },
    },
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
      {
        // Real remote D1 through Wrangler's remote bindings; skipped unless configured
        // (tests/remote/support.ts, docs/agents/remote-smoke.md).
        extends: true,
        test: {
          name: "remote",
          include: ["tests/remote/**/*.test.ts"],
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
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
    jsPlugins: ["./scripts/lint/module-header.mjs"],
    overrides: [
      {
        // Each library and command line module opens with what it owns (scripts/lint/), and stays
        // small enough to read: a module that outgrows the limit is split, not exempted.
        files: ["src/**/*.ts", "cli/**/*.ts"],
        rules: {
          "d1-record/module-header": "error",
          "max-lines": ["error", { max: 500, skipBlankLines: true, skipComments: true }],
        },
      },
      {
        // A describe() callback holds a whole suite, so it's long by design.
        files: ["tests/**"],
        rules: { "max-lines-per-function": "off" },
      },
    ],
  },
  fmt: {
    // Kept verbatim: the original design brief, and skills vendored from upstream.
    ignorePatterns: ["docs/brief.md", ".claude/skills/**", "skills-lock.json"],
  },
});
