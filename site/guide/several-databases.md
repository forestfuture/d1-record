---
description: "Use two or more D1 databases from one Worker: a schema and base class for each binding, generators that choose a database, and per-request options for several at once."
---

# Multiple databases

A Worker can bind several D1 databases. Each gets its own schema file and base class, and each Model queries the database its base class names.

## Binding the databases

Add each database to your Wrangler config, with its own `migrations_dir`:

```jsonc [wrangler.jsonc]
{
  "d1_databases": [
    { "binding": "DB", "database_name": "my-app-db", "database_id": "…" },
    {
      "binding": "LOGS",
      "database_name": "my-app-logs",
      "database_id": "…",
      "migrations_dir": "logs-migrations",
    },
  ],
}
```

Wrangler applies a folder’s migrations to one database, so each needs its own folder.

## Generating a schema for each

Generate the schemas as usual:

```sh
npx d1-record schema
```

With several databases, it writes one of each per binding:

| Binding | Schema           | Base class                                   |
| ------- | ---------------- | -------------------------------------------- |
| `DB`    | `src/db/DB.ts`   | `DbRecord`, in `src/models/db-record.ts`     |
| `LOGS`  | `src/db/LOGS.ts` | `LogsRecord`, in `src/models/logs-record.ts` |

Each base class names its binding, so its Models query that database:

```ts
import { LogsRecord } from "./logs-record";

export class Entry extends LogsRecord("entries") {}

await Entry.where({ level: "error" }).count(); // on LOGS
```

## Generating Models for one database

Name the binding with `--database`:

```sh
npx d1-record g model Entry 'level:string!' message --database LOGS
npx wrangler d1 migrations apply my-app-logs --local
```

## Opening several for a request

To open a request’s databases with a Session or `onQuery`, pass them all to `withDatabase`. Each Model uses the one on its binding:

<<< @/snippets/guide/connecting.ts#several{ts}

::: warning TIP
A batch writes to one database, so entries from two databases throw `IncompatibleRelation`.
:::
