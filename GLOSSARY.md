# d1-record

A Rails-inspired Active Record library for Cloudflare Workers backed by Cloudflare D1. It maps D1 rows to domain objects with a lazy, composable query vocabulary and a predictable persistence lifecycle.

## Language

**Model**:
A class created with `Model({...attributes})`, or with the app's `ApplicationRecord("table")` from the **Generated schema**, that describes one D1 table: its attributes, validations, callbacks, associations and scopes.
_Avoid_: Record (as the base class; `ApplicationRecord` is the one exception, named as Rails names it), entity, schema

**Generated schema**:
The file `d1-record schema` writes from a project's migrations: each table's attributes, as a document like Rails' `schema.rb`. It's committed, and never edited by hand; the app's `ApplicationRecord` builds Models on it.
_Avoid_: Schema dump, types file

**Base class**:
The app's class extending `Model.Base` (in `application-record.ts`) that every Model is built on, so the methods, callbacks and scopes written on it are shared, as on Rails' `ApplicationRecord`. It's abstract: it has no table.
_Avoid_: Mixin, concern, parent model

**Generator**:
The `d1-record g model` and `g migration` commands: they write a migration (and a Model) from a name and columns, checked against the existing migrations first.
_Avoid_: Scaffold, codegen

**Console**:
The interactive session `d1-record console` opens: a REPL on the project's local D1 database, with its Models and `db` in scope and each line run against that database. Local unless `--remote`, which opens the real database after its name is typed. With `-e` it isn't a session: it runs one piece of code, prints its result alone, and exits. A **Generator** writes files; the console works with data.
_Avoid_: Shell, REPL (in the guide), playground

**Override**:
A change a Model makes to an attribute of the **Generated schema** (its type, nullability, default, **Generated id**, or **Epoch storage**), or `false` to ignore the column.
_Avoid_: Patch, customization

**Epoch storage**:
How a `datetime` **Attribute** is held when its column is an `INTEGER` of Unix time, not ISO text: `storage: "unixSeconds"` or `"unixMilliseconds"`, as Drizzle's `timestamp` and `timestamp_ms` modes write it. The attribute is still a `Date`.
_Avoid_: Numeric datetime, timestamp mode

**Record**:
One instance of a **Model**, representing a single row that is either persisted or not yet saved.
_Avoid_: Row (outside the hydration boundary), object, instance

**New record** / **Persisted record** / **Destroyed record**:
The three lifecycle states of a **Record**: not yet written, backed by a row, or backed by a row that this instance deleted. A destroyed record is a read-only snapshot of the deleted row.
_Avoid_: Saved, deleted, frozen

**Cast**:
Reading a value given to an attribute as the attribute's type, by how it reaches the attribute (its use), accepting only what's unambiguous: `"false"` is `false` for a boolean, `"42"` is 42 for an integer. **Assigned** values (set, built, given to a bulk write or `permit`) are strict. **Condition** values also read a number as its digits for a string attribute. **Key** values (copied from another record through an association, or inherited from a Relation's conditions) are cast as condition values are. A value that can't be cast is **uncastable**: an assigned or key value is an error, and a condition with one matches nothing.
_Avoid_: Coerce, convert (D1's storage form is conversion), parse

**Filtered attribute**:
An attribute whose values listeners, errors, and a printed record show as `"[FILTERED]"` (passwords, tokens, keys, emails), named by the Model's `filterAttributes`. D1 still gets the real values.
_Avoid_: Redacted, masked, sensitive field; and "filter" alone, which means a **Scope**'s conditions

**Hidden attribute**:
An attribute `toJSON()` leaves out, named by the Model's `hiddenAttributes`, by exact name. `attributes()` still has it. Independent of a **Filtered attribute**, which is about logs and errors.
_Avoid_: Private, protected, excluded

**Snapshot**:
A Record's attribute values as last loaded from or saved to D1. Changes are measured against it, and `reload()` replaces it.
_Avoid_: Original, previous values, dirty state

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
A wrapper around a `D1Database` binding, made with `connect(env.DB, { session, onQuery })`, that queries go through. It's the **Current database** for a request run in `withDatabase`, or used explicitly with `db.model(User)`; a Model's **Binding** gets one with no per-request options.
_Avoid_: Connection, client, context (on its own)

**Attribute**:
A value declared on a **Model**, with a camelCase name, the snake_case column it maps to, and a type that says how its value moves between JavaScript and SQLite. Only declared attributes can appear in object-style queries or be written.
_Avoid_: Field, property

**Generated id**:
A string **Attribute** declared with `generateId: true`, whose value, when not given, comes from its **Model**'s `generateId` where a default would: a key made in code, before the row is written. A `TEXT` primary key in the **Generated schema** is one.
_Avoid_: Generated attribute, auto id

**Column**:
The D1 table column behind an **Attribute**. The word only applies on the SQL side: raw SQL fragments name columns, and everything else names attributes.
_Avoid_: Attribute (when talking about SQL)

**Relation**:
A lazy, immutable description of a query against one **Model**. Each modifier returns a new Relation, and only a terminal operation (`toArray`, `first`, `count`, …) runs a query.
_Avoid_: Query, query builder, scope (for a Relation)

**Page**:
One page of a **Relation**'s records, from `paginate()`, with its position (`page`, `perPage`, `hasNext`, `hasPrevious`) and, when counted, the `total` it's a page of. A plain object, ready for `Response.json()`.
_Avoid_: Paginator, cursor (that's keyset pagination), batch (that's D1's)

**Scope**:
A named, reusable change to a Relation, declared on a **Model**, that may take arguments. Calling a scope never runs a query.
_Avoid_: Filter, named query

**Association**:
A named link from one **Model** to another through a foreign-key **Attribute**: `belongsTo`, `hasMany` or `hasOne`.
_Avoid_: Relationship, relation (a Relation is a query)

**Preload**:
Loading an **Association** for many **Records** at once, in a small, bounded number of queries, so each becomes a **Loaded association**. You ask for it with `includes`.
_Avoid_: Eager load, join

**Loaded association**:
An **Association** a **Record** already holds, preloaded or read once, so reading it again needs no query. It stays loaded while the key it was loaded for is unchanged, until the record is reloaded.
_Avoid_: Cached association (outside the implementation), memoized

**Association scope**:
A change to an **Association**'s **Relation** declared with the association (its order or conditions), applied whenever the association is read, preloaded or written through. Unlike a **Scope**, it has no name of its own.
_Avoid_: Scope (on its own), default scope

**Dependent strategy**:
What destroying a **Record** does to an **Association**'s records: destroy them, delete them, nullify their foreign key, or refuse while they exist (a restriction, which isn't an **Abort**).
_Avoid_: Cascade (that's the database's), dependent destroy (for all of them)

**Query listener**:
A function called once per statement sent to D1 (`onQuery`): a database's, for one request's queries, or a Model class's (`static onQuery`, usually on the **Base class**), for every query of its Models. It only observes: it never changes a query's outcome.
_Avoid_: Logger, hook, middleware

**Current database**:
The database a query started from a Model (`User.find(id)`) uses: the request's, set with `withDatabase`, or else the Model's **Binding**'s. Never stored on a class.
_Avoid_: Default connection, global database

**Binding**:
The name of the D1 binding a Model queries, from the Wrangler config (`static binding = "DB"`), usually set on the app's **Base class**.
_Avoid_: Connection name, database name

**Session**:
A D1 session that one **Database** can be opened with. Every query in that request goes through it, so the request reads its own writes even when reads are served by replicas.
_Avoid_: Transaction, connection

**Statement**:
A bulk write prepared for a **Batch** rather than run (`toInsert`, `toUpdateAll`, `toDeleteAll`, …), skipping validations and callbacks. It runs only with its **Batch**, and is never run by being awaited. Its SQL can be read with `toSql()`, unsent.
_Avoid_: Query, command

**Batch**:
An atomic group of **Statements** and **Record statements** run together with D1's `batch()`: all are written, or none.
_Avoid_: Transaction

**Autosave**:
Saving a **Record** also saves the new records of its **Associations**, validated with it: those built through a has-many or has-one, after it and with its key (and theirs, at every level), and a new record it points at through a belongs-to, before it, so it can take that record's key.
_Avoid_: Nested save, cascade save

**Record statement**:
A **Record**'s save or destroy as part of a **Batch** (`user.toSave()`). Unlike a **Statement**, it isn't compiled in advance: the record's validations and callbacks run when the batch runs. It's never run by being awaited.
_Avoid_: Pending save, deferred write
