import { describe, expect, test } from "vite-plus/test";
import { connect, InvalidModel, Model, UnknownAssociation, type HasMany } from "../../src/index.ts";

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

  test("replacing an association's target Model's associations after first use throws on the next read", () => {
    class Comment extends Model({ id: "integer", postId: "integer" }) {
      static tableName = "comments";
    }
    class Article extends Model({ id: "integer" }) {
      static tableName = "posts";
      static associations = this.defineAssociations({
        comments: this.hasMany(() => Comment, { foreignKey: "postId" }),
      });
      declare comments: HasMany<typeof Comment>;
    }
    class Writer extends Model({ id: "integer" }) {
      static tableName = "users";
      static associations = this.defineAssociations({
        articles: this.hasMany(() => Article, { foreignKey: "id" }),
      });
      declare articles: HasMany<typeof Article>;
    }
    const writer = db.model(Writer).build();
    writer.articles();

    Article.associations = {} as typeof Article.associations;

    expect(() => writer.articles()).toThrow(InvalidModel);
  });

  test("a subclass that replaces its associations without one no longer has it, as the contract says", () => {
    class Author extends Model({ id: "integer" }) {
      static tableName = "users";
      static associations = this.defineAssociations({
        posts: this.hasMany(() => Post, { foreignKey: "userId" }),
      });
      declare posts: HasMany<typeof Post>;
    }
    class Reader extends Author {
      // Replaced by a plain object that leaves `posts` out (spreading the parent's would keep it).
      static override associations = {} as typeof Author.associations;
    }
    db.model(Author);

    expect(() => db.model(Reader).build().posts()).toThrow(UnknownAssociation);
  });

  test("an inferred key that isn't declared is rejected, saying where it came from", () => {
    class APIKey extends Model({ id: "integer" }) {
      static tableName = "api_keys";
      static associations = this.defineAssociations({
        posts: this.hasMany(() => Post), // APIKey → apiKeyId, which Post doesn't declare
      });
    }
    class Draft extends Model({ id: "integer" }) {
      static tableName = "posts";
      static associations = this.defineAssociations({
        writer: this.belongsTo(() => Post), // writer → writerId, which Draft doesn't declare
      });
    }

    expect(() => db.model(APIKey)).toThrow(
      /APIKey association "posts": Post has no attribute "apiKeyId" \(inferred from the class name APIKey/,
    );
    expect(() => db.model(Draft)).toThrow(
      /Draft association "writer": Draft has no attribute "writerId" \(inferred from the association name writer/,
    );
  });

  test("associations declared without defineAssociations need an explicit foreignKey", () => {
    class Plain extends Model({ id: "integer" }) {
      static tableName = "users";
      static associations = { posts: this.hasMany(() => Post) } as never;
    }

    expect(() => db.model(Plain)).toThrow(
      /Plain association "posts" has no foreignKey.*defineAssociations/,
    );
  });

  test("an explicit foreignKey wins over the inferred one", () => {
    class Writer extends Model({ id: "integer" }) {
      static tableName = "users";
      static associations = this.defineAssociations({
        posts: this.hasMany(() => Post, { foreignKey: "userId" }),
      });
    }

    expect(() => db.model(Writer)).not.toThrow();
  });
});
