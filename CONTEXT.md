# d1-record

A Rails-inspired Active Record library for Cloudflare Workers backed by Cloudflare D1. It maps D1 rows to domain objects with a lazy, composable query vocabulary and a predictable persistence lifecycle.

## Language

**Model**:
A class that extends the library's `Model` base class and describes one D1 table: its columns, validations, callbacks, associations and scopes.
_Avoid_: Record (as the base class), entity, schema

**Record**:
One instance of a **Model**, representing a single row that is either persisted or not yet saved.
_Avoid_: Row (outside the hydration boundary), object, instance

**New record** / **Persisted record** / **Destroyed record**:
The three lifecycle states of a **Record**: not yet written, backed by a row, or backed by a row that this instance deleted. A destroyed record is a read-only snapshot of the deleted row.
_Avoid_: Saved, deleted, frozen

**Partial record**:
A **Record** loaded through a Relation with `select(...)`. Only the selected attributes and the primary key are loaded. Reading any other attribute is an error, not `null`.
_Avoid_: Projection, sparse record

**SQL fragment**:
A piece of SQL built with the `sql` tagged template, in which every interpolated value is a bound parameter. It's the only form in which hand-written SQL reaches a Relation.
_Avoid_: Raw SQL, string condition

**Abort**:
A deliberate refusal raised by a pre-write callback with `abort(reason)`. It cancels the write without being a validation failure.
_Avoid_: Halt, cancel, returning false

**Database**:
A per-request wrapper around a `D1Database` binding, created explicitly at the application edge. Every query and write for that request goes through it.
_Avoid_: Connection, client, context (on its own)

**Attribute**:
A value declared on a **Model**, with a camelCase name, the snake_case column it maps to, and a type that says how its value moves between JavaScript and SQLite. Only declared attributes can appear in object-style queries or be written.
_Avoid_: Field, property

**Column**:
The D1 table column behind an **Attribute**. The word only applies on the SQL side: raw SQL fragments name columns, and everything else names attributes.
_Avoid_: Attribute (when talking about SQL)

**Relation**:
A lazy, immutable description of a query against one **Model**. Each modifier returns a new Relation, and only a terminal operation (`toArray`, `first`, `count`, …) runs a query.
_Avoid_: Query, query builder, scope (for a Relation)

**Scope**:
A named, reusable change to a Relation, declared on a **Model**, that may take arguments. Calling a scope never runs a query.
_Avoid_: Filter, named query

**Association**:
A named link from one **Model** to another through a foreign-key **Attribute**: `belongsTo`, `hasMany` or `hasOne`.
_Avoid_: Relationship, relation (a Relation is a query)

**Preload**:
Loading an **Association** for many **Records** at once, in a small, bounded number of queries, so reading it later needs no query at all. You ask for it with `includes`.
_Avoid_: Eager load, join

**Session**:
A D1 session that one **Database** can be opened with. Every query in that request goes through it, so the request reads its own writes even when reads are served by replicas.
_Avoid_: Transaction, connection
