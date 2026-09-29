import { describe, expectTypeOf, test } from "vite-plus/test";
import {
  between,
  connect,
  gte,
  lt,
  Model,
  sql,
  type BelongsTo,
  type HasMany,
  type HasOne,
  Relation,
  type RecordStatement,
} from "../../src/index.ts";

class User extends Model({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  isActive: "boolean",
  createdAt: "datetime",
  ratio: "real",
  settings: "json",
}) {
  static tableName = "users";

  get label(): string {
    return this.email.toUpperCase();
  }
}

// connect() never touches the binding until a query runs, and these tests run none.
const db = connect({} as never);

describe("types", () => {
  test("record properties are inferred from Model({...}), nullable unless null: false", () => {
    expectTypeOf<User["id"]>().toEqualTypeOf<number>();
    expectTypeOf<User["email"]>().toEqualTypeOf<string>();
    expectTypeOf<User["isActive"]>().toEqualTypeOf<boolean | null>();
    expectTypeOf<User["createdAt"]>().toEqualTypeOf<Date | null>();
    expectTypeOf<User["ratio"]>().toEqualTypeOf<number | null>();
    expectTypeOf<User["settings"]>().toEqualTypeOf<unknown>();
  });

  test("a relation resolves to records of its model", () => {
    const relation = db.model(User);

    expectTypeOf(relation).toEqualTypeOf<Relation<User>>();
    expectTypeOf<ReturnType<typeof relation.toArray>>().toEqualTypeOf<Promise<User[]>>();
    expectTypeOf(db.models({ User }).User).toEqualTypeOf<Relation<User>>();
  });

  test("where accepts declared attributes with their value types, or an sql fragment", () => {
    const users = db.model(User);

    // Checked by the type checker only; never called.
    const typeOnly = () => {
      users.where({ isActive: true, createdAt: null });
      users.where(sql`email = ${"a@example.com"}`);
      // @ts-expect-error wrong value type for a boolean attribute
      users.where({ isActive: "yes" });
      // @ts-expect-error getters aren't attributes
      users.where({ label: "A" });
      // @ts-expect-error email can't be null
      users.where({ email: null });
      users.where({ id: [1, 2], isActive: [true, null] });
      // @ts-expect-error email can't be null, so null can't be in its array either
      users.where({ email: ["a@example.com", null] });
      // @ts-expect-error array items must have the attribute's type
      users.where({ id: ["1"] });
      users.where({ id: gte(2), createdAt: between(new Date(), new Date()), email: lt("m") });
      // @ts-expect-error a comparison's value must have the attribute's type
      users.where({ id: gte("2") });
      // @ts-expect-error nor can a comparison compare with null
      users.where({ createdAt: gte(null) });
      // @ts-expect-error booleans aren't ordered, so they can't be compared
      users.where({ isActive: gte(true) });
      // @ts-expect-error a comparison's parts are internal: build one with gt, gte, lt, lte or between
      void gte(1).operator;
      // @ts-expect-error likewise its values
      void between(1, 2).values;
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("order and reorder take directions, nulls placement, or an sql fragment", () => {
    const users = db.model(User);

    // Checked by the type checker only; never called.
    const typeOnly = () => {
      users.order({ createdAt: { direction: "desc", nulls: "last" }, id: "asc" });
      users.reorder(sql`lower(email)`);
      users.reorder();
      // @ts-expect-error nulls is "first" or "last"
      users.order({ createdAt: { direction: "desc", nulls: "never" } });
      // @ts-expect-error plain strings aren't orders
      users.order("email");
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("per-attribute change tracking is typed from the Model's attributes", () => {
    // Checked by the type checker only; never called.
    const typeOnly = (user: User) => {
      expectTypeOf(user.attributeWas("email")).toEqualTypeOf<string>();
      expectTypeOf(user.savedChangeTo("createdAt")).toEqualTypeOf<
        [before: Date | null, after: Date | null] | undefined
      >();
      user.isAttributeChanged("isActive", { from: false, to: true });
      user.restoreAttributes(["email", "isActive"]);
      // @ts-expect-error unknown attribute
      user.attributeWas("nope");
      // @ts-expect-error from must have the attribute's type
      user.hasSavedChangeTo("email", { from: 1 });
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("find with one id returns a record, with several or an array, records", () => {
    const users = db.model(User);

    // Checked by the type checker only; never called.
    const typeOnly = async () => {
      expectTypeOf(await users.find(1)).toEqualTypeOf<User>();
      expectTypeOf(await users.find(1, 2)).toEqualTypeOf<User[]>();
      expectTypeOf(await users.find([1, 2])).toEqualTypeOf<User[]>();
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("finders and pluck return precise types", () => {
    const users = db.model(User);

    expectTypeOf<ReturnType<typeof users.findBy>>().toEqualTypeOf<Promise<User | null>>();
    expectTypeOf<ReturnType<typeof users.first>>().toEqualTypeOf<Promise<User | null>>();

    // Checked by the type checker only; never called.
    const typeOnly = async () => {
      expectTypeOf(await users.pluck("email")).toEqualTypeOf<string[]>();
      expectTypeOf(await users.pluck("id", "isActive")).toEqualTypeOf<[number, boolean | null][]>();
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("order, select, pluck and count accept only declared attributes", () => {
    const users = db.model(User);

    // Checked by the type checker only; never called.
    const typeOnly = () => {
      users.order({ createdAt: "desc", id: "asc" }).select("email", "isActive").distinct();
      void users.count("isActive");
      // @ts-expect-error direction must be "asc" or "desc"
      users.order({ id: "up" });
      // @ts-expect-error getters aren't attributes
      users.order({ label: "asc" });
      // @ts-expect-error unknown attribute
      users.select("nope");
      // @ts-expect-error unknown attribute
      void users.pluck("nope");
      // @ts-expect-error unknown attribute
      void users.count("nope");
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("the record lifecycle API is typed against the Model's attributes", () => {
    const users = db.model(User);
    const user = users.build({ email: "a@example.com" });

    expectTypeOf(user).toEqualTypeOf<User>();
    expectTypeOf<ReturnType<typeof users.create>>().toEqualTypeOf<Promise<User>>();
    expectTypeOf<ReturnType<typeof users.createOrThrow>>().toEqualTypeOf<Promise<User>>();
    expectTypeOf<ReturnType<typeof user.save>>().toEqualTypeOf<Promise<boolean>>();
    expectTypeOf<ReturnType<typeof user.destroy>>().toEqualTypeOf<Promise<User | false>>();
    expectTypeOf<ReturnType<typeof user.destroyOrThrow>>().toEqualTypeOf<Promise<User>>();
    expectTypeOf<ReturnType<typeof user.reload>>().toEqualTypeOf<Promise<User>>();

    // Checked by the type checker only; never called.
    const typeOnly = async () => {
      user.assign({ isActive: true, createdAt: null });
      await user.update({ email: "b@example.com" });
      // @ts-expect-error unknown attribute
      users.build({ nope: 1 });
      // @ts-expect-error wrong value type
      user.assign({ isActive: "yes" });
      // @ts-expect-error email can't be null
      await user.update({ email: null });
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("validations and callbacks are typed against the Model", () => {
    // Checked by the type checker only; never called.
    const typeOnly = () => {
      class Account extends Model({ id: "integer", email: { type: "string", null: false } }) {
        static tableName = "accounts";
        static {
          this.validates("email", { presence: true, if: (account) => account.email.length > 0 });
          this.beforeSave((account) => {
            expectTypeOf(account).toEqualTypeOf<Account>();
            expectTypeOf(account.email).toEqualTypeOf<string>();
          });
          // @ts-expect-error unknown attribute
          this.validates("nope", { presence: true });
          // @ts-expect-error unknown validator
          this.validates("email", { mustBe: "shiny" });
        }
      }
      return Account;
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("scope calls are typed through chaining", () => {
    class Post extends Model({ id: "integer", published: "boolean", createdAt: "datetime" }) {
      static tableName = "posts";
      static scopes = this.defineScopes({
        published: (q) => q.where({ published: true }),
        since: (q, date: Date) => q.where({ createdAt: date }),
        // Q6: sibling scopes aren't typed inside a scope body.
        // @ts-expect-error `published` isn't visible on q here
        both: (q) => q.published(),
      });
    }
    const posts = db.model(Post);

    // Checked by the type checker only; never called.
    const typeOnly = () => {
      const chained = posts.where({ published: true }).published().since(new Date()).limit(5);
      expectTypeOf<ReturnType<typeof chained.toArray>>().toEqualTypeOf<Promise<Post[]>>();
      expectTypeOf(db.models({ Post }).Post.published).toBeFunction();
      // @ts-expect-error since() takes a Date
      posts.since("yesterday");
      // @ts-expect-error unknown scope
      posts.archived();
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("Relations and record statements can't be mixed up or made by hand", () => {
    class Other extends Model({ id: "integer", title: "string" }) {
      static tableName = "posts";
    }
    // Checked by the type checker only; never called.
    const typeOnly = (user: User) => {
      // @ts-expect-error Relations come from db.model() and other Relations
      void new Relation();
      // @ts-expect-error a record statement keeps its record's type
      const statement: RecordStatement<Other> = user.toSave();
      void statement;
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("db.batch resolves to each entry's result: the record, or D1's meta", () => {
    // Checked by the type checker only; never called.
    const typeOnly = async (user: User) => {
      const [saved, meta] = await db.batch([
        user.toSave(),
        db.model(User).where({ id: 1 }).deleteAll(),
      ]);
      expectTypeOf(saved).toEqualTypeOf<User>();
      expectTypeOf(meta.changes).toEqualTypeOf<number>();
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("upsert's uniqueBy names the Model's attributes", () => {
    const users = db.model(User);

    // Checked by the type checker only; never called.
    const typeOnly = () => {
      users.upsertAll([{ email: "a@example.com" }], { uniqueBy: "email" });
      users.upsert({ id: 1 }, { uniqueBy: ["id", "email"] });
      // @ts-expect-error unknown attribute
      users.upsert({ id: 1 }, { uniqueBy: "nope" });
      // @ts-expect-error onDuplicate only skips; updating is upsert
      users.insert({ id: 1 }, { onDuplicate: "update" });
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("dependent: takes the strategies of the association's kind", () => {
    // Checked by the type checker only; never called.
    const typeOnly = () => {
      class Owner extends Model({ id: "integer" }) {
        static tableName = "users";
        static associations = this.defineAssociations({
          posts: this.hasMany(() => Owner, { foreignKey: "id", dependent: "deleteAll" }),
          profile: this.hasOne(() => Owner, { foreignKey: "id", dependent: "delete" }),
          // @ts-expect-error a hasOne deletes its one record with "delete", not "deleteAll"
          other: this.hasOne(() => Owner, { foreignKey: "id", dependent: "deleteAll" }),
          // @ts-expect-error belongsTo has no dependent strategies
          parent: this.belongsTo(() => Owner, { foreignKey: "id", dependent: "destroy" }),
        });
      }
      return Owner;
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("associations are typed from their declare lines, including includes() names", () => {
    class Author extends Model({ id: "integer" }) {
      static tableName = "users";
      static associations = this.defineAssociations({
        articles: this.hasMany(() => Article, { foreignKey: "authorId" }),
        bio: this.hasOne(() => Bio, { foreignKey: "authorId" }),
      });
      declare articles: HasMany<typeof Article>;
      declare bio: HasOne<typeof Bio>;
    }
    class Article extends Model({ id: "integer", authorId: "integer", live: "boolean" }) {
      static tableName = "posts";
      static associations = this.defineAssociations({
        author: this.belongsTo(() => Author, { foreignKey: "authorId" }),
      });
      static scopes = this.defineScopes({ live: (q) => q.where({ live: true }) });
      declare author: BelongsTo<typeof Author>;
    }
    class Bio extends Model({ id: "integer", authorId: "integer" }) {
      static tableName = "profiles";
    }

    // Checked by the type checker only; never called.
    const typeOnly = async (author: Author, article: Article) => {
      expectTypeOf(await article.author()).toEqualTypeOf<Author | null>();
      expectTypeOf(await author.bio()).toEqualTypeOf<Bio | null>();
      expectTypeOf(await author.articles().live().toArray()).toEqualTypeOf<Article[]>();
      expectTypeOf(author.loaded("articles")).toEqualTypeOf<Article[]>();
      expectTypeOf(author.loaded("bio")).toEqualTypeOf<Bio | null>();
      db.model(Author).includes("articles", "bio").includes({ articles: "author" });
      // @ts-expect-error unknown association
      db.model(Author).includes("posts");
      // @ts-expect-error unknown nested association
      db.model(Author).includes({ articles: "comments" });
      // @ts-expect-error attributes aren't associations
      author.loaded("id");
      expectTypeOf(author.isLoaded("bio")).toEqualTypeOf<boolean>();
      article.author.set(author);
      article.author.set(null);
      // @ts-expect-error set() takes a record of the association's Model
      article.author.set(article);
      expectTypeOf(article.author.build({ id: 1 })).toEqualTypeOf<Author>();
      expectTypeOf(await author.bio.createOrThrow({ id: 2 })).toEqualTypeOf<Bio>();
      // @ts-expect-error build() takes the target's attributes
      author.bio.build({ nope: 1 });
      expectTypeOf(await author.reloadAssociation("articles")).toEqualTypeOf<Article[]>();
      expectTypeOf(await article.reloadAssociation("author")).toEqualTypeOf<Author | null>();
      // @ts-expect-error unknown association
      await author.reloadAssociation("posts");
    };
    expectTypeOf(typeOnly).toBeFunction();
  });
});
