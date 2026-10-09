---
"@forestfuture/d1-record": patch
---

`npx d1-record console` opens your local D1 database in a console with your Models loaded, as `rails console` does: `const user = await User.find(id)`, `await user.update({ name: "Johnny" })`, then `user` to see it. It takes `--database`, `--models` and `--config`, keeps its history in `.wrangler/d1-record-history`, never opens a remote database, and reads TypeScript Models (extensionless imports and `tsconfig.json` paths included) through `jiti`, now a dependency of the command line. The guide has a new Console page.
