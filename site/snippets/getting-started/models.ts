// src/models.ts
import { Model, type BelongsTo, type HasMany } from "@forestfuture/d1-record";

export class User extends Model({
  id: { type: "string", null: false, default: () => crypto.randomUUID() },
  email: { type: "string", null: false },
  isActive: "boolean", // column: is_active
  createdAt: "datetime", // set for you on create
  updatedAt: "datetime", // set for you on every change
}) {
  static associations = this.defineAssociations({
    posts: this.hasMany(() => Post, { dependent: "destroy" }), // foreign key: Post's userId
  });
  declare posts: HasMany<typeof Post>;

  static scopes = this.defineScopes({
    active: (q) => q.where({ isActive: true }),
  });

  static {
    this.validates("email", { presence: true, uniqueness: true });
    this.beforeSave((user) => {
      user.email = user.email.toLowerCase();
    });
  }
}

export class Post extends Model({
  id: { type: "integer", null: false },
  userId: { type: "string", null: false },
  title: { type: "string", null: false },
  publishedAt: "datetime",
}) {
  static associations = this.defineAssociations({
    // Named author, not user, so the foreign key is given.
    author: this.belongsTo(() => User, { foreignKey: "userId" }),
  });
  declare author: BelongsTo<typeof User>;
}
