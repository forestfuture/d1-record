---
description: "How to open a console on your D1 database with your Models loaded: d1-record console, what is in scope, its options, opening the remote database with --remote, and where its data and history live."
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

local> const user = await User.find("c5c765b4-b7e1-428e-aa00-88d58f622c71")
#=> undefined
local> user
#=> User { id: 'c5c765b4-b7e1-428e-aa00-88d58f622c71', name: 'Alice', email: [FILTERED] }
local> await user.update({ name: "Johnny" })
#=> true
local> const admins = await User.where({ role: "admin" }).toArray()
#=> undefined
```

Leave with `quit`, `exit`, or Ctrl-D. Ctrl-C stops a line that’s still running. `.help` lists the console’s own commands, and `npx d1-record c` is the short form.

## What you can use

- **Your Models,** by class name, from every file in `src/models`. They query your local database with no `db` to pass.
- **`db`,** your connected database, for `db.batch([...])` and `db.model(...)`.
- **Top-level `await`,** and `const` and `let`, which last until you leave.

A record prints as it does in a log: its class and attributes, with a filtered attribute as `[FILTERED]` and an unsaved change next to the value it had. [Printing records](./models#printing-records) has the details.

An error prints and the console carries on.

## Reloading your Models

After you edit a Model, or a file it imports, read them again without leaving:

```text
> reload!
Reloaded: Post, User
```

`.reload` does the same. A Model you added appears, and one whose file you removed goes. Records and values you already hold keep their old class, so run the lines that made them again.

If a file fails to load, say a syntax error in the middle of an edit, the console names the file and keeps the Models you had.

::: warning TIP
Only files in your project’s folder are read again. Your database connection and `@forestfuture/d1-record` stay as they are.
:::

## Seeing the SQL

Start with `--verbose` to see each statement a line runs, or turn it on and off while you work with `.verbose`:

```text
> .verbose
SQL logging on
> await User.find(1)
  User  1.2ms  SELECT * FROM "users" WHERE (("id" = ?)) LIMIT ?  [ 1, 1 ]
#=> User { id: 1, name: 'Alice', email: [FILTERED] }
```

Each line shows the Model, the time, the SQL, and the values it bound. Filtered attributes show as `[FILTERED]`, as they do in `onQuery`. A statement that fails prints `failed` and the reason in place of the time. `verbose!` toggles it too, and `.verbose on` and `.verbose off` set it explicitly.

::: warning TIP
The SQL comes from the database’s own `onQuery`, so a listener you set on your base class still runs as well.
:::

## Choosing what to open

| Option              |                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `--database <name>` | The D1 binding to open, when your Wrangler config has several.                             |
| `--models <path>`   | Where your Models are: a folder (`src/models` by default) or one file (`src/models.ts`).   |
| `--config <file>`   | Use this Wrangler config instead of finding `wrangler.jsonc`, `wrangler.json`, or `.toml`. |
| `--no-history`      | Don’t keep what you type in the history file.                                              |
| `--verbose`         | Print each statement a line runs, to begin with. `.verbose` turns it on and off.           |
| `--remote`          | Open your remote database instead, after you type its name. See below.                     |
| `--yes`             | With `--remote`, don’t ask first. It’s also how to open it without a terminal.             |
| `--history`         | Keep what you type in a remote session, which isn’t kept unless you ask.                   |

## Where your data lives

The console opens the local database in `.wrangler/state`, beside your Wrangler config. It’s the same one `wrangler dev` and `wrangler d1 migrations apply --local` use, so apply your migrations first, and what you change in the console is what your dev server sees.

It opens your remote database only when you ask with `--remote`, and never for a binding your config marks `remote: true` by itself.

It starts only that D1 binding. The rest of your Wrangler config (Durable Objects, services, `vars`, and the secrets in `.dev.vars`) isn’t started, so it can’t warn or fail on them, and your Models can’t reach them either.

On a terminal, what you type is kept in `.wrangler/d1-record-history`, which Wrangler projects already ignore. A line can hold a token or an email, so add `--no-history` when you’d rather it wasn’t kept.

## Opening your remote database

`--remote` opens the real database your binding points at, to look at production data or fix one record by hand:

```sh
npx d1-record console --remote
```

It names the database and waits for you to type its name. Anything else, including `y`, cancels and opens nothing:

```text
Remote database DB (shop, id 1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d)
What you change in the console is changed in this database, not a copy.
Type its name to continue, anything else cancels: shop
```

Once it’s open, the prompt says `remote>` (in red on a terminal) where a local session says `local>`, so the two can’t be mistaken for each other:

```text
Remote database DB (shop, id 1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d)
Models: Post, User

remote> await User.count()
#=> 42
```

::: danger Changes are real
There’s no copy and no undo. `await user.destroy()` deletes that row from your remote database, and `User.deleteAll()` deletes them all.
:::

- **Signing in.** The console uses your Wrangler login, or `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the environment. It takes the account from `account_id` in your Wrangler config when it names one. Opening a remote database starts a temporary preview Worker, as `wrangler dev` does for a remote binding, so the token needs **D1: Edit** and **Workers Scripts: Edit**, and the account needs a `workers.dev` subdomain. When Cloudflare refuses, the console prints its reason and how to sign in.
- **Without a terminal.** There’s no one to type the name, so it refuses unless you add `--yes`, which is how a script opens it: `echo 'await User.count()' | npx d1-record console --remote --yes`.
- **The database it opens.** The binding needs a `database_id`. When it also has a `preview_database_id`, Wrangler opens that one in place of `database_id`, and the console says so: `Remote preview database DB (…)`.
- **No history.** What you type isn’t kept unless you add `--history`.
- **Local files.** Nothing is written to `.wrangler/state`; the local database isn’t touched.

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

::: rails Beyond Rails
`rails console` opens whichever environment you start it in, without asking. `--remote` asks you to type the database’s name first, and its prompt says `remote>`.
:::
