---
description: "belongsTo, hasMany and hasOne: inferred foreign keys, reading, preloading with includes, autosave, writing through associations, scopes and dependent strategies."
---

# Associations

Associations connect Models: `belongsTo`, `hasMany` and `hasOne`, as in Rails. Each is a field of the Model, `articles = hasMany(Article)`, much like Rails' `has_many :articles`: the field's name is the association's name, and TypeScript knows `author.articles()` from it.

| Association | Foreign key                                                                       | Reading it                                      | Writing through it                                                                             | `dependent:`                                                                              |
| ----------- | --------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `belongsTo` | On this record. Inferred from the association's name: `author` → `authorId`       | `await record.author()`: the record, or `null`  | `set(record)`, `build()`, `create()`, `createOrThrow()`                                        | None                                                                                      |
| `hasMany`   | On the target's records. Inferred from this Model's class name: `User` → `userId` | `record.posts()`: a Relation of the records     | `build()`, `create()`, `createOrThrow()`, and bulk writes (`insert`, `updateAll`, `deleteAll`) | `"destroy"`, `"deleteAll"`, `"nullify"`, `"restrictWithException"`, `"restrictWithError"` |
| `hasOne`    | On the target's record. Inferred from this Model's class name: `User` → `userId`  | `await record.profile()`: the record, or `null` | `build()`, `create()`, `createOrThrow()`                                                       | `"destroy"`, `"delete"`, `"nullify"`, `"restrictWithException"`, `"restrictWithError"`    |

Every association takes the same options:

| Option       | What it sets                                                           | Default                        |
| ------------ | ---------------------------------------------------------------------- | ------------------------------ |
| `foreignKey` | The attribute holding the link (an attribute, not a column)            | Inferred, as above             |
| `primaryKey` | The attribute the foreign key points at                                | The primary key                |
| `scope`      | Narrows or orders the association's records: `(q) => q.where(…)`       | None                           |
| `dependent`  | What destroying the owner does to the records (`hasMany` and `hasOne`) | None: D1's foreign keys decide |

<<< @/snippets/guide/associations.ts#declare{ts}

Pass the target Model's class. Models can refer to each other in any order, because a field is only evaluated when a record is made, by which time every class exists.

A subclass inherits its parent's associations, and can redeclare one to change it.

## Foreign keys

A foreign key names an **attribute**, not a column: `authorId`, where Rails writes `author_id`. When you leave it out, it's inferred by Rails' convention:

- `belongsTo`: the association's name + `Id`. `author = belongsTo(Author)` uses the record's own `authorId`.
- `hasMany` and `hasOne`: the Model's class name + `Id`, on the target. `Author`'s associations use `authorId`, `BlogPost`'s use `blogPostId`, and `APIKey`'s use `apiKeyId`.

Pass `foreignKey` when the name doesn't follow the convention, for example `author = belongsTo(User, { foreignKey: "userId" })`. `primaryKey` names the attribute it points at, which defaults to the primary key.

::: details Bundlers and class names
Inferring from a class name needs the class to keep its name when your Worker is bundled. Wrangler keeps names by default, even when minifying. If a bundler renames `Author` to something like `e`, the inferred `eId` doesn't exist, and the first use of the Model throws `InvalidModel`, saying where the key came from. Pass `foreignKey`, or keep class names in your bundler's settings.
:::

Keys aren't checked by TypeScript, since that would make Models that point at each other circular. They're checked the first time a Model is used, with an `InvalidModel` that names the missing attribute.

## Reading

<<< @/snippets/guide/associations.ts#read{ts}

- `await article.author()` and `await author.profile()` resolve to a record or `null`.
- `author.articles()` is a Relation of the author's articles, with every Relation method and the target's scopes.
- Nothing is queried when there's nothing to find: a `belongsTo` whose foreign key is `null`, or a `hasMany`/`hasOne` on an owner that isn't saved yet.

A loaded association is cached on the record, as in Rails. Reading `author()` again doesn't query, and neither does `articles().toArray()` once the collection is loaded. Changing a foreign key makes the next read query again. `reload()` clears the cache, and `await record.reloadAssociation("articles")` reloads one association.

## Preloading

Loading an association inside a loop sends one query per record. `includes` loads it for every record at once, with one query per association, however many records there are:

<<< @/snippets/guide/associations.ts#preload{ts}

Nest with an object: `includes({ articles: "comments" })` or `includes({ articles: ["comments", "tags"] })`. Names are typed from the association fields. `record.loaded("profile")` reads a loaded association synchronously, and throws `AssociationNotLoaded` if it wasn't, so a template can never quietly send a query. `record.isLoaded("profile")` asks first.

## Creating through an association

Records built or created through a `hasMany` get the owner's key:

<<< @/snippets/guide/associations.ts#create-through{ts}

### Autosave

A record built through an association is saved with its owner, as Rails does. Build a whole graph, then save the owner:

<<< @/snippets/guide/associations.ts#autosave{ts}

- The built records are validated with the owner. An invalid article makes the author invalid ("Articles is invalid"), with its own errors on the article.
- When the owner's key is **generated in code**, as here, everything is written in one atomic batch.
- When **D1 generates** the key (an `INTEGER PRIMARY KEY`), the key doesn't exist until the owner is written. So the owner is written first, its records follow in the next batch, and their own built records in the one after, a level at a time. The batches aren't atomic together: if a record fails at the second level (only a constraint error can, since everything was validated first), the save throws with the owner already saved and the record still new. Generate keys in code wherever a graph must save all at once.

### Writing through `belongsTo` and `hasOne`

The accessor of a `belongsTo` or `hasOne` also has methods, for what Rails does with `article.author = …`, `build_author` and `build_profile`:

<<< @/snippets/guide/associations.ts#writers{ts}

- `set(record)` points the record at another one, and `set(null)` clears it. It's written when the record is saved.
- `build(attrs)` makes a new associated record. `create(attrs)` and `createOrThrow(attrs)` save it at once.
- A new record set or built through a `belongsTo` is validated with its owner and saved **before** it, so the owner's foreign key can be filled in.

## Association scopes

An association can narrow or order its records, as Rails' `has_many :posts, -> { … }`. The scope applies to lazy reads and preloads alike, and records created through the association take its equality values:

<<< @/snippets/guide/associations.ts#scoped{ts}

`q` is the target's Relation, typed with its attributes and scopes.

::: details A Model's association to itself, scoped with its own scopes
TypeScript can't infer this one case on its own: `children = hasMany(Category, { scope: (q) => q.top() })` inside `Category`, where `top` is one of `Category`'s scopes. Write the field's type out, and the rest is still inferred:

<<< @/snippets/guide/associations.ts#self-referencing{ts}

:::

A scope that uses `limit`, `offset` or `distinct` works when read lazily, but can't be preloaded: it would apply to every owner's records together, so `includes` throws `IncompatibleRelation`.

## Dependent records

`dependent:` sets what destroying the owner does to its associated records:

| Strategy                   | What happens                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `"destroy"`                | Each record is destroyed with its own callbacks and dependents                          |
| `"deleteAll"` / `"delete"` | The records are deleted in one statement, without callbacks (`"delete"` for a `hasOne`) |
| `"nullify"`                | Their foreign keys are set to `NULL`                                                    |
| `"restrictWithException"`  | The destroy throws `DeleteRestriction` while there are records                          |
| `"restrictWithError"`      | The destroy returns `false`, with an error on the owner's `base`                        |

Everything a destroy does, the owner's DELETE included, is written in one atomic batch: all of it happens, or none of it does. Strategies run after the owner's `beforeDestroy` callbacks, so an `abort()` leaves the records alone. Without a strategy, it's up to the database. If the table declares the foreign key (`user_id TEXT REFERENCES users (id)`), D1 enforces it, and destroying an owner whose records still point at it throws `InvalidForeignKey`. If it doesn't, the records are left pointing at a row that's gone.

## Writing to many at once

`insert`, `updateAll` and `deleteAll` work through a `hasMany` too, scoped to the owner's records, and so do their `to…` forms for a batch:

<<< @/snippets/guide/associations.ts#statements{ts}

As in Rails, `deleteAll()` on the association itself follows its `dependent:` strategy: it deletes the records for `"destroy"` or `"deleteAll"`, and otherwise sets their foreign key to `NULL`. See [Batches and bulk writes](./batches).

## Not supported

Polymorphic associations, `has_many :through`, counter caches and inverse inference aren't supported.
