---
description: "belongsTo, hasMany and hasOne: inferred foreign keys, reading, preloading with includes, autosave, writing through associations, scopes and dependent strategies."
---

# Associations

Associations connect Models: `belongsTo`, `hasMany` and `hasOne`, as in Rails. Each is a field of the Model, `articles = hasMany(Article)`, much like Rails’ `has_many :articles`: the field’s name is the association’s name, and TypeScript knows `author.articles()` from it.

<<< @/snippets/guide/associations.ts#declare{ts}

Pass the target Model’s class. Models can refer to each other in any order, because a field is only evaluated when a record is made, by which time every class exists.

A subclass inherits its parent’s associations, and can redeclare one to change it.

## belongsTo

`author = belongsTo(User, options)`

Declares that each record points at one record of another Model. Use it on the Model whose table holds the foreign key: a post `belongsTo` its author.

Each record gets:

- **`await record.author()`**: the associated record, or `null`. It’s read once, then cached.
- **`record.author.set(user)`**: points the record at another record, setting its foreign key; `set(null)` clears it. Written when the record is saved.
- **`record.author.build(attrs)`**: a new record for it to point at. It’s validated with the record and saved **before** it, so the foreign key can be filled in.
- **`record.author.create(attrs)`** and **`createOrThrow(attrs)`**: save a new record at once and point at it. The record itself isn’t saved.

<<< @/snippets/guide/associations.ts#belongs-to{ts}

Options:

- **`foreignKey`**: the attribute on this record that holds the link. Defaults to the association’s name + `Id`: `author` → `authorId`.
- **`primaryKey`**: the attribute on the target it points at. Defaults to the target’s primary key.
- **`scope`**: narrows the target, `(q) => q.where(…)`. See [Association scopes](#association-scopes).

## hasMany

`posts = hasMany(Post, options)`

Declares that many records of another Model point at each record. Use it on the Model the other table’s foreign key refers to: a user `hasMany` posts.

Each record gets:

- **`record.posts()`**: a Relation of the associated records, with every Relation method and the target’s scopes. Its records are cached once loaded.
- **`record.posts().build(attrs)`**: a new record with the owner’s key, saved with the owner. See [Autosave](#autosave).
- **`record.posts().create(attrs)`** and **`createOrThrow(attrs)`**: save a new record at once. The owner must already be saved.
- **`record.posts().insert(…)`, `updateAll(…)` and `deleteAll()`**: bulk writes scoped to the owner’s records, and their `to…` forms for a batch. See [Writing to many at once](#writing-to-many-at-once).

<<< @/snippets/guide/associations.ts#has-many{ts}

Options:

- **`foreignKey`**: the attribute on the target’s records that holds the link. Defaults to this Model’s class name + `Id`: `User` → `userId`.
- **`primaryKey`**: the attribute on this record the foreign key points at. Defaults to the primary key.
- **`scope`**: narrows or orders the records, `(q) => q.order(…)`. See [Association scopes](#association-scopes).
- **`dependent`**: what destroying the owner does to the records: `"destroy"`, `"deleteAll"`, `"nullify"`, `"restrictWithException"` or `"restrictWithError"`. See [Dependent records](#dependent-records).

## hasOne

`profile = hasOne(Profile, options)`

Declares that one record of another Model points at each record. Use it on the Model the other table’s foreign key refers to, when there’s at most one: a user `hasOne` profile.

Each record gets:

- **`await record.profile()`**: the associated record, or `null`. It’s read once, then cached. If several records point at it, it’s the first by the scope’s order, then the primary key.
- **`record.profile.build(attrs)`**: a new record with the owner’s key, saved with the owner.
- **`record.profile.create(attrs)`** and **`createOrThrow(attrs)`**: save a new record at once. The owner must already be saved.

<<< @/snippets/guide/associations.ts#has-one{ts}

Options:

- **`foreignKey`**: the attribute on the target’s record that holds the link. Defaults to this Model’s class name + `Id`: `User` → `userId`.
- **`primaryKey`**: the attribute on this record the foreign key points at. Defaults to the primary key.
- **`scope`**: narrows or orders the target, `(q) => q.where(…)`. See [Association scopes](#association-scopes).
- **`dependent`**: what destroying the owner does to the record: `"destroy"`, `"delete"`, `"nullify"`, `"restrictWithException"` or `"restrictWithError"`. See [Dependent records](#dependent-records).

## Foreign keys

A foreign key names an **attribute**, not a column: `authorId`, where Rails writes `author_id`. When you leave it out, it’s inferred by Rails’ convention:

- `belongsTo`: the association’s name + `Id`. `author = belongsTo(Author)` uses the record’s own `authorId`.
- `hasMany` and `hasOne`: the Model’s class name + `Id`, on the target. `Author`‘s associations use `authorId`, `BlogPost`‘s use `blogPostId`, and `APIKey`‘s use `apiKeyId`.

Pass `foreignKey` when the name doesn’t follow the convention, for example `author = belongsTo(User, { foreignKey: "userId" })`. `primaryKey` names the attribute it points at, which defaults to the primary key.

::: details Bundlers and class names
Inferring from a class name needs the class to keep its name when your Worker is bundled. Wrangler keeps names by default, even when minifying. If a bundler renames `Author` to something like `e`, the inferred `eId` doesn’t exist, and the first use of the Model throws `InvalidModel`, saying where the key came from. Pass `foreignKey`, or keep class names in your bundler’s settings.
:::

Keys aren’t checked by TypeScript, since that would make Models that point at each other circular. They’re checked the first time a Model is used, with an `InvalidModel` that names the missing attribute.

## Loading and caching

Nothing is queried when there’s nothing to find: a `belongsTo` whose foreign key is `null`, or a `hasMany`/`hasOne` on an owner that isn’t saved yet.

A loaded association is cached on the record, as in Rails. Reading `author()` again doesn’t query, and neither does `articles().toArray()` once the collection is loaded. Changing a foreign key makes the next read query again. `reload()` clears the cache, and `await record.reloadAssociation("articles")` reloads one association.

## Preloading

Loading an association inside a loop sends one query per record. `includes` loads it for every record at once, with one query per association, however many records there are:

<<< @/snippets/guide/associations.ts#preload{ts}

Nest with an object: `includes({ articles: "comments" })` or `includes({ articles: ["comments", "tags"] })`. Names are typed from the association fields. `record.loaded("profile")` reads a loaded association synchronously, and throws `AssociationNotLoaded` if it wasn’t, so a template can never quietly send a query. `record.isLoaded("profile")` asks first.

## Creating through an association

Records built or created through a `hasMany` get the owner’s key:

<<< @/snippets/guide/associations.ts#create-through{ts}

### Autosave

A record built through an association is saved with its owner, as Rails does. Build a whole graph, then save the owner:

<<< @/snippets/guide/associations.ts#autosave{ts}

- The built records are validated with the owner. An invalid article makes the author invalid (“Articles is invalid”), with its own errors on the article.
- When the owner’s key is **generated in code**, as here, everything is written in one atomic batch.
- When **D1 generates** the key (an `INTEGER PRIMARY KEY`), the key doesn’t exist until the owner is written. So the owner is written first, its records follow in the next batch, and their own built records in the one after, a level at a time. The batches aren’t atomic together: if a record fails at the second level (only a constraint error can, since everything was validated first), the save throws with the owner already saved and the record still new. Generate keys in code wherever a graph must save all at once.

## Association scopes

An association can narrow or order its records, as Rails’ `has_many :posts, -> { … }`. The scope applies to lazy reads and preloads alike, and records created through the association take its equality values:

<<< @/snippets/guide/associations.ts#scoped{ts}

`q` is the target’s Relation, typed with its attributes and scopes.

::: details A Model’s association to itself, scoped with its own scopes
TypeScript can’t infer this one case on its own: `children = hasMany(Category, { scope: (q) => q.top() })` inside `Category`, where `top` is one of `Category`‘s scopes. Write the field’s type out, and the rest is still inferred:

<<< @/snippets/guide/associations.ts#self-referencing{ts}

:::

A scope that uses `limit`, `offset` or `distinct` works when read lazily, but can’t be preloaded: it would apply to every owner’s records together, so `includes` throws `IncompatibleRelation`.

## Dependent records

`dependent:` sets what destroying the owner does to its associated records:

| Strategy                   | What happens                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `"destroy"`                | Each record is destroyed with its own callbacks and dependents                          |
| `"deleteAll"` / `"delete"` | The records are deleted in one statement, without callbacks (`"delete"` for a `hasOne`) |
| `"nullify"`                | Their foreign keys are set to `NULL`                                                    |
| `"restrictWithException"`  | The destroy throws `DeleteRestriction` while there are records                          |
| `"restrictWithError"`      | The destroy returns `false`, with an error on the owner’s `base`                        |

Everything a destroy does, the owner’s DELETE included, is written in one atomic batch: all of it happens, or none of it does. Strategies run after the owner’s `beforeDestroy` callbacks, so an `abort()` leaves the records alone. Without a strategy, it’s up to the database. If the table declares the foreign key (`user_id TEXT REFERENCES users (id)`), D1 enforces it, and destroying an owner whose records still point at it throws `InvalidForeignKey`. If it doesn’t, the records are left pointing at a row that’s gone.

## Writing to many at once

`insert`, `updateAll` and `deleteAll` work through a `hasMany` too, scoped to the owner’s records, and so do their `to…` forms for a batch:

<<< @/snippets/guide/associations.ts#statements{ts}

As in Rails, `deleteAll()` on the association itself follows its `dependent:` strategy: it deletes the records for `"destroy"` or `"deleteAll"`, and otherwise sets their foreign key to `NULL`. See [Bulk writes and batches](./batches).

## Not built yet

These association features aren’t in d1-record yet, though nothing in D1 prevents any of them. The code shows the shape they’re likely to take; it may change when they’re designed.

- **Associations through another** ([#59](https://github.com/forestfuture/d1-record/issues/59)): `projects = hasMany(Project, { through: "assignments" })`, a user’s projects reached through their assignments. Reading them needs no SQL join, only a subquery; writing through them is the larger part.
- **Polymorphic associations** ([#60](https://github.com/forestfuture/d1-record/issues/60)): `commentable = belongsTo([Post, Photo])`, a comment that belongs to a post or a photo, with `comments = hasMany(Comment, { as: "commentable" })` on each. They need a stable name for each Model, since the stored type can’t rely on class names a bundler may change.
- **Counter caches** ([#61](https://github.com/forestfuture/d1-record/issues/61)): `post = belongsTo(Post, { counterCache: true })`, keeping a `commentsCount` on each post. Its update can go in the same atomic batch as the write, so it can’t drift.
- **Inverse associations** ([#62](https://github.com/forestfuture/d1-record/issues/62)): after `await post.comments().toArray()`, each `comment.post()` returns that same post, without a query.
