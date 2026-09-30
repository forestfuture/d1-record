import { Model, type BelongsTo, type HasMany } from "@forestfuture/d1-record";

export class User extends Model({
  id: { type: "string", null: false, default: () => crypto.randomUUID() },
  email: { type: "string", null: false },
  createdAt: "datetime", // createdAt and updatedAt are set on save
  updatedAt: "datetime",
}) {
  static tableName = "users"; // required

  static associations = this.defineAssociations({
    posts: this.hasMany(() => Post, { dependent: "destroy" }), // foreign key inferred: Post's userId
  });
  declare posts: HasMany<typeof Post>;

  static {
    this.validates("email", { presence: true, uniqueness: true });
  }
}

export class Post extends Model({
  id: { type: "string", null: false, default: () => crypto.randomUUID() },
  userId: { type: "string", null: false },
  title: { type: "string", null: false },
}) {
  static tableName = "posts";

  static associations = this.defineAssociations({
    user: this.belongsTo(() => User), // foreign key inferred: userId
  });
  declare user: BelongsTo<typeof User>;
}
