# Where dependency APIs live

Read a dependency's types and docs from these paths, rather than searching `node_modules`:

- **D1 and the Workers runtime**: `node_modules/@cloudflare/workers-types/index.d.ts` (`D1Database`, `D1DatabaseSession`, and the `cloudflare:workers` module).
- **Wrangler's API** (`getPlatformProxy`, remote bindings): `node_modules/wrangler/wrangler-dist/cli.d.ts`. What it does that the types don't say, such as how D1 migrations are numbered and tracked, is in `cli.js` beside it.
- **Miniflare**: `node_modules/miniflare/dist/src/index.d.ts`. Tests reach it only through `tests/support/d1.ts`.
- **Vite+** commands and config: `node_modules/vite-plus/docs/guide/<command>.md`. `lint.md` covers the repo's own lint rules (`scripts/lint/`).
- **Oxlint rules** and their options: https://oxc.rs/docs/guide/usage/linter/rules.html. `vp lint --rules` prints nothing here.
- **tsdown**, which `vp pack` runs: its config types are under `node_modules/.pnpm/@voidzero-dev+vite-plus-core@*/node_modules/@voidzero-dev/vite-plus-core/dist/tsdown/`.
