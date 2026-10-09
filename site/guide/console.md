---
description: "How to open a console on your local D1 database with your Models loaded: d1-record console, what is in scope, its options, and where its data and history live."
---

# Console

Open a console on your local database, with your Models loaded, to try a query or fix a record by hand. Run it from the folder with your Wrangler config:

```sh
npx d1-record console
```

It prints which database and Models it opened, then waits for a line:

```text
Local database DB (.wrangler/state)
Models: Post, User

> const user = await User.find("c5c765b4-b7e1-428e-aa00-88d58f622c71")
#=> undefined
> user
#=> User { id: 'c5c765b4-b7e1-428e-aa00-88d58f622c71', name: 'Alice', email: [FILTERED] }
> await user.update({ name: "Johnny" })
#=> true
> const admins = await User.where({ role: "admin" }).toArray()
#=> undefined
```

Leave with `quit`, `exit`, or Ctrl-D. Ctrl-C stops a line that’s still running. `npx d1-record c` is the short form.

## What you can use

- **Your Models,** by class name, from every file in `src/models`. They query your local database with no `db` to pass.
- **`db`,** your connected database, for `db.batch([...])` and `db.model(...)`.
- **Top-level `await`,** and `const` and `let`, which last until you leave.

A record prints as it does in a log: its class and attributes, with a filtered attribute as `[FILTERED]` and an unsaved change next to the value it had. [Printing records](./models#printing-records) has the details.

An error prints and the console carries on.

## Choosing what to open

| Option              |                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `--database <name>` | The D1 binding to open, when your Wrangler config has several.                             |
| `--models <path>`   | Where your Models are: a folder (`src/models` by default) or one file (`src/models.ts`).   |
| `--config <file>`   | Use this Wrangler config instead of finding `wrangler.jsonc`, `wrangler.json`, or `.toml`. |

## Where your data lives

The console opens the local database in `.wrangler/state`, beside your Wrangler config. It’s the same one `wrangler dev` and `wrangler d1 migrations apply --local` use, so apply your migrations first, and what you change in the console is what your dev server sees.

It never opens your remote database, even for a binding your config marks `remote: true`.

On a terminal, what you type is kept in `.wrangler/d1-record-history`, which Wrangler projects already ignore. A line can hold a token or an email, so add `--no-history` when you’d rather it wasn’t kept.

## Running a few lines at once

Lines you paste or pipe run in order, each after the one before, and the console finishes them before it exits:

```sh
echo 'await User.count()' | npx d1-record console
```

::: warning TIP
The console reads your TypeScript Models directly, including extensionless imports and `tsconfig.json` paths, so it works in TypeScript projects. It needs Node.js 22.13 or later, and `wrangler` and `@forestfuture/d1-record` installed in your project. It uses your copies, so your Models and the console share one library.
:::

::: warning Only in projects you trust
The console runs your project’s code: your Models, and the `wrangler` and `@forestfuture/d1-record` in its `node_modules`. Run it in a project you’d run `wrangler dev` in.
:::

::: rails Compared with Rails
This is `rails console` for D1: your Models in scope, and records printed as `inspect` prints them.
:::
