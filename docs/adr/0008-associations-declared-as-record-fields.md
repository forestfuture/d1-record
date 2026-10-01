# Associations are declared as record fields

An association is a field of the Model's records: `posts = hasMany(Post, { dependent: "destroy" })`, `author = belongsTo(User)`. TypeScript infers the accessor's type from the field's initializer, so the association is declared once, with no `declare posts: HasMany<typeof Post>` line. Before this, associations were declared twice: once in `static associations = this.defineAssociations({...})` for the runtime, and once as a `declare` for TypeScript. People had to look up the `declare` syntax each time.

Every shape that keeps the declaration on the class fails TypeScript once two Models point at each other (`User` ↔ `Post`), which is the normal case. We prototyped each one against the real library:

- Associations as a second argument to `Model({...}, {...})`, plain or wrapped in a function: TS2506, a class referenced in its own base expression.
- Static `associations`, plus `interface User extends Associations<typeof User> {}`: TS2310, "recursively references itself as a base type". It only compiled with simplified stand-in types.
- Instance fields: fully typed, in either declaration order. `includes` names, the target's scopes (`user.posts().published()`), `loaded()` and `post.user.set(…)` all work, and an unknown name is rejected.

Instance fields compile because their initializers are typed like any member, not as part of the class's heritage. For the same reason, the target is passed directly (`hasMany(Post)`), not as `() => Post`. A field's initializer runs when a record is made, by which time every Model class exists. The function was only ever needed because static declarations ran while the classes were still being defined.

## Consequences

- **A per-record cost:** JavaScript runs a record's field initializers each time one is created. The library reads a Model's declarations once, from a probe record, and removes the fields from each record it makes, so the accessors on the prototype answer, as before. Measured with `vp run bench:hydrate`:
  - Hydrating 10,000 records went from 9.6 ms to 13.8 ms, about 0.4 µs per record.
  - `toArray()` of 10,000 rows from Miniflare's D1 went from 58 ms to 66 ms.

  That's invisible next to a deployed D1's own latency. Creating records with `Object.create` (skipping the initializers) measured +19% and +5%. But it skips constructors, and needs a fallback for Models with plain class fields, so it wasn't worth a second construction path. It can be added if a real workload needs it.

- **Inheritance:** a subclass inherits its parent's associations, as class fields, and redeclaring a field replaces one. Removing one isn't possible, as in Rails.
- **Inferred foreign key:** a field initializer can't tell which class body it's in. So a `hasMany`/`hasOne`'s inferred foreign key comes from the class that extends `Model({...})`, the same class the table name comes from, rather than from the declaring class. Rails uses the declaring class; the two differ only for a subclass that declares one without `foreignKey`.
- **Typed scopes:** association scopes are typed from the target (`scope: (q) => q.order(...)`), which the old untyped declarations couldn't do.
- **`new User()`:** on a record constructed directly, the association fields hold their declarations, and calling one throws `NoDatabase`, as other database operations on such a record do.
- **Supersedes** ADR-0007's last consequence: associations no longer need a `declare`.
