# Generated tables get a `TEXT` key made in code, not an integer

`d1-record g model` gives a table `id TEXT PRIMARY KEY NOT NULL`, and the generated schema makes its value in code (`crypto.randomUUID()`) when a record is built. `--id integer` opts into an `INTEGER PRIMARY KEY`, which D1 assigns when the row is written. This departs from Rails, whose tables get an auto-incrementing integer `id` and opt into UUIDs, and from SQLite, whose native key is the integer rowid.

The reason is atomicity. D1 has no transactions; a batch is the only atomic write, and its statements can only point at each other through keys that exist before it's sent. A key made in code exists from `build()`, so saving a record with the records built through it (autosave), or a `db.batch` of new records that point at each other, is one atomic batch. With a key D1 assigns, the owner has to be written first to learn its key, and its records follow in a later batch: a failure there leaves the owner saved. Rails pays nothing for integer keys, since a transaction wraps the whole save; on D1 they cost atomic saves, so the default is the key that keeps them.

## Consequences

- **A Rails developer's first surprise.** The guide says so in a Compared with Rails box where keys first appear (Getting started, Generators) and on Coming from Rails.
- **Random keys don't sort by creation.** `first()` and `last()` with no order sort by the primary key, which for UUIDv4 is no meaningful order. Time-ordered keys (#63) would give it one; `generateId` (#99) lets an app choose its key function in one place.
- **Integer keys stay one flag away** (`--id integer`), and a reference column takes its target's key type, so a project can mix both. A project-wide setting, as Rails' `primary_key_type`, can be added if people ask.

## Amended (#99, 2026-10-07)

The generated schema now declares the key `generateId: true` rather than `default: () => crypto.randomUUID()`, so the Model's `static generateId` makes it: `crypto.randomUUID()` unless the app's base class overrides it (UUIDv7, ULID, a prefix). The decision is unchanged; only where the key's function lives moved, to one place per app.
