---
description: "What's different from Rails' Active Record: queries start from the request, camelCase attributes, OrThrow methods, batches instead of transactions."
---

# Coming from Rails

Most of d1-record will feel familiar: Models, validations, callbacks, associations, scopes and dirty tracking all follow Active Record, down to the default error messages. This page covers what’s different, and why.

## Queries start from the Model

```ts
// Rails: User.where(active: true)
const users = await User.where({ isActive: true }).toArray();
```

As in Rails, a Model queries by itself. Its binding (`static override binding = "DB"`, on your app’s base class) plays the part of `connects_to`. A Worker serves many requests at once from one isolate, so nothing about a request is ever stored on the class: for a D1 Session or per-request logging, run the request in [`withDatabase(connect(env.DB, { … }), …)`](./connecting). A record keeps the database it came from.

## Naming

| Rails                                    | d1-record                                         |
| ---------------------------------------- | ------------------------------------------------- |
| `created_at` (attribute)                 | `createdAt`, mapped to `created_at`               |
| `foreign_key: :user_id`                  | `foreignKey: "userId"`                            |
| `save!`, `create!`, `find_by!`           | `saveOrThrow`, `createOrThrow`, `findByOrThrow`   |
| `new_record?`, `persisted?`              | `isNewRecord()`, `isPersisted()`                  |
| `empty?`, `any?`                         | `isEmpty()`, `hasAny()`                           |
| `changed?`, `saved_change_to_email?`     | `isChanged()`, `hasSavedChangeTo("email")`        |
| `rails generate model Post title:string` | `npx d1-record g model Post title:string`         |
| `db/schema.rb`, `rails db:schema:dump`   | `src/db/schema.ts`, `npx d1-record schema`        |
| `class Post < ApplicationRecord`         | `class Post extends ApplicationRecord("posts")`   |
| `scope :active, -> { … }`                | `static active = this.scope((q) => …)`            |
| `has_many :posts, dependent: :destroy`   | `posts = hasMany(Post, { dependent: "destroy" })` |
| `post.author = user`                     | `post.author.set(user)`                           |
| `build_profile`                          | `user.profile.build()`                            |
| `reload_author`                          | `post.reloadAssociation("author")`                |
| `throw :abort`                           | `throw abort("reason")`                           |
| `to_json`                                | `toJSON()`                                        |

Attributes, conditions and association keys all name **attributes**, in camelCase. Column names only appear inside `sql` fragments. Foreign keys are inferred by Rails’ conventions (`userId` for `User`’s `has_many`), with `foreignKey` to override them.

## Declaring a Model

As in Rails, migrations define the columns and a model declares only behavior. Rails reads the columns from the database when the app runs; d1-record reads them when you run `d1-record schema` (or a generator), into `src/db/schema.ts`, so TypeScript knows every attribute’s type. A Model names its table in `ApplicationRecord("…")`, since TypeScript can’t derive a class’s types from its name. Scopes are statics, and validations and callbacks go in a `static {}` block, where Rails puts them in the class body:

<<< @/snippets/guide/coming-from-rails.ts#declare{ts}

## Atomic writes without transactions

Bulk writes run when called, as in Rails: `await Post.where(…).deleteAll()` resolves to how many rows it deleted. There’s no `transaction do … end`: D1 can’t keep a transaction open across awaits. [`db.batch([...])`](./batches), with records’ `toSave()`/`toDestroy()` and bulk writes’ `toUpdateAll()`/`toDeleteAll()`/…, writes a prepared set of statements and records atomically. Generating keys in code makes whole graphs of new records atomic too. See [D1’s limits](./d1).

The generators follow `rails generate model` and `rails generate migration`, with one addition: a column can have a literal default, `count:integer!=0`, which Rails’ generators can’t express. See [Generators](./generators).

## Smaller differences

- `insert` and `insertAll` raise on duplicates. Skipping them is opt-in, with `{ onDuplicate: "skip" }`.
- `insert` fills in declared defaults, since that’s where keys are generated.
- `merge` replaces the order rather than appending to it.
- `last()` can’t reverse an `sql` fragment order, and throws `IrreversibleOrder`, rather than trying to parse SQL.
- `find(1, 1)` always returns an array, so its return type follows its arguments.
- `dependent:` strategies run after the owner’s `beforeDestroy` callbacks, wherever they’re declared, so an `abort()` always protects the records.
- Records in a batch run all their before-callbacks before any write, and their after-callbacks after all of them.
- Scopes preloaded with `limit` throw, where Rails silently gives wrong results.

## Not (yet) supported

Default scopes, `has_many :through`, polymorphic associations, single-table inheritance, counter caches, `destroy_async` and i18n of error messages.
