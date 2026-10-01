import { belongsTo, hasMany, Model } from "@forestfuture/d1-record";

export class User extends Model({
  id: { type: "string", null: false, default: () => crypto.randomUUID() },
  email: { type: "string", null: false },
  createdAt: "datetime", // createdAt and updatedAt are set on save
  updatedAt: "datetime",
}) {
  // Its table, users, is inferred from the class name; static tableName overrides it.
  posts = hasMany(Post, { dependent: "destroy" }); // foreign key inferred: Post's userId

  static {
    this.validates("email", { presence: true, uniqueness: true });
  }
}

export class Post extends Model({
  id: { type: "string", null: false, default: () => crypto.randomUUID() },
  userId: { type: "string", null: false },
  title: { type: "string", null: false },
}) {
  user = belongsTo(User); // foreign key inferred: userId
}
