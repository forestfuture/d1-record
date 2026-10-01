---
"@forestfuture/d1-record": minor
---

Associations are declared as record fields, written once: `posts = hasMany(Post, { dependent: "destroy" })`, `author = belongsTo(User)`, `profile = hasOne(Profile)`, imported from the package. TypeScript infers each accessor's type, and association scopes are typed from their target. **Breaking:** `static associations = this.defineAssociations({...})` and the `declare posts: HasMany<typeof Post>` lines are gone. Move each association into a field, and drop its `declare` line.
