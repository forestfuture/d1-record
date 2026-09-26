import { describe, expect, test } from "vite-plus/test";
import { connect, InvalidModel, Model, type HasMany } from "../../src/index.ts";

// No D1 needed: these checks happen when a Model is first used.
const db = connect({} as never);

class Post extends Model({ id: "integer", userId: "integer", title: "string" }) {
  static tableName = "posts";
}

describe("association declarations", () => {
  test("an association named like an attribute or a record method is rejected", () => {
    class Shadow extends Model({ id: "integer", posts: "json" }) {
      static tableName = "users";
      static associations = this.defineAssociations({
        posts: this.hasMany(() => Post, { foreignKey: "userId" }),
      });
    }
    class Clash extends Model({ id: "integer" }) {
      static tableName = "users";
      static associations = this.defineAssociations({
        save: this.hasMany(() => Post, { foreignKey: "userId" }),
      });
    }

    expect(() => db.model(Shadow)).toThrow(/Shadow.*"posts".*attribute/);
    expect(() => db.model(Clash)).toThrow(InvalidModel);
  });

  test("a foreignKey that isn't a declared attribute is rejected", () => {
    class Typo extends Model({ id: "integer" }) {
      static tableName = "users";
      static associations = this.defineAssociations({
        posts: this.hasMany(() => Post, { foreignKey: "user_id" }),
      });
    }
    class Owner extends Model({ id: "integer" }) {
      static tableName = "posts";
      static associations = this.defineAssociations({
        author: this.belongsTo(() => Post, { foreignKey: "authorId" }),
      });
    }

    expect(() => db.model(Typo)).toThrow(/Typo.*"posts".*Post.*"user_id"/);
    expect(() => db.model(Owner)).toThrow(/Owner.*"author".*"authorId"/);
  });

  test("a target that isn't a Model is rejected", () => {
    class Lost extends Model({ id: "integer" }) {
      static tableName = "users";
      static associations = this.defineAssociations({
        posts: this.hasMany(() => "Post", { foreignKey: "userId" }),
      });
    }

    expect(() => db.model(Lost)).toThrow(/Lost.*"posts".*Model/);
  });

  test("a subclass has its parent's associations; replacing them after first use throws", () => {
    class Author extends Model({ id: "integer" }) {
      static tableName = "users";
      static associations = this.defineAssociations({
        posts: this.hasMany(() => Post, { foreignKey: "userId" }),
      });
      declare posts: HasMany<typeof Post>;
    }
    class Guest extends Author {}

    const guest = db.model(Guest).build();
    expect(typeof guest.posts).toBe("function");

    db.model(Author);
    Author.associations = Author.defineAssociations({
      posts: Author.hasMany(() => Post, { foreignKey: "title" }),
    });
    expect(() => db.model(Author)).toThrow(/Author.*associations.*static/);
  });
});
