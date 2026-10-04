---
description: "Use two or more D1 databases from one Worker: a schema and base class for each binding, generators that choose a database, and per-request options for several at once."
---

# Use several databases

A Worker can bind several D1 databases. In d1-record, each gets its own schema file and its own base class, and each Model queries the database its base class names.

## Bind the databases

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

Give each database its own `migrations_dir`, since Wrangler applies a folder's migrations to one database.

## Generate a schema and base class for each

```sh
npx d1-record schema
```

With several databases, it writes one of each per binding, named as Rails names a second database's base class:

| Binding | Schema           | Base class                                   |
| ------- | ---------------- | -------------------------------------------- |
| `DB`    | `src/db/DB.ts`   | `DbRecord`, in `src/models/db-record.ts`     |
| `LOGS`  | `src/db/LOGS.ts` | `LogsRecord`, in `src/models/logs-record.ts` |

Each base class names its binding (`static override binding = "LOGS"`), so its Models query that database:

```ts
import { LogsRecord } from "./logs-record";

export class Entry extends LogsRecord("entries") {}

await Entry.where({ level: "error" }).count(); // on LOGS
```

## Generate Models and migrations for one of them

Name the binding with `--database`:

```sh
npx d1-record g model Entry 'level:string!' message --database LOGS
npx wrangler d1 migrations apply my-app-logs --local
```

## Per-request options for several

To open a request's databases with a Session or `onQuery`, pass them all to `withDatabase`. Each Model uses the one on its own binding:

<<< @/snippets/guide/connecting.ts#several{ts}

A batch writes to one database: statements and records from two databases in one `batch([...])` are refused, with `IncompatibleRelation`.
