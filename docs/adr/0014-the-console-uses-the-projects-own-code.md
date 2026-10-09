# The console loads the project's own library, and reads its TypeScript through jiti

`d1-record console` evaluates the project's Models against its local database. Two choices decide whether that works, and both are easy to get wrong without noticing.

**It resolves `@forestfuture/d1-record` and `wrangler` from the project, not from the CLI.** `npx d1-record` may run a different copy of the library than the one the Models import (a global install, a different version in a monorepo). Two copies are two `withDatabase` `AsyncLocalStorage` stores and two `Model` base classes: a Model from one would not see the database the console set up with the other, and `instanceof Model.Base` would fail. One `jiti` instance, based in the project, imports the Models and the library, so they resolve to the same module. Wrangler is the project's own dependency (it runs `wrangler dev`), so d1-record gains none for it.

**It reads TypeScript with `jiti`, not Node's type stripping.** Node 22.18 and later run `.ts` files, but only with explicit extensions and erasable syntax. The guide's Models import each other as `./application-record`, and a project may map `@/` in `tsconfig.json`. `jiti` handles both. It cannot be bundled into `dist/cli.mjs`: it loads its Babel transform from a sibling file when it runs. So `jiti` is a regular dependency, the only one, and only the CLI imports it; the library the Workers import has none.

## Consequences

- **TypeScript projects only.** A JavaScript project's Models would load, but nothing is tested or documented for them.
- **One dependency to keep current.** `jiti` is small and has no dependencies of its own.
- **Local state follows `wrangler dev`.** `getPlatformProxy` keeps its state relative to the working directory by default, which could be any folder; the console passes `<config dir>/.wrangler/state/v3` and `remoteBindings: false`, so it neither opens a different database nor reaches a remote one.
