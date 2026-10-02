import {
  belongsTo,
  type Database,
  hasMany,
  hasOne,
  Model,
  type HasMany,
} from "@forestfuture/d1-record";

// #region declare
export class Author extends Model({
  id: { type: "string", null: false, default: () => crypto.randomUUID() },
  name: { type: "string", null: false },
}) {
  articles = hasMany(Article, { dependent: "destroy" }); // Article's authorId
  profile = hasOne(Profile, { dependent: "delete" }); // Profile's authorId
}

export class Article extends Model({
  id: { type: "string", null: false, default: () => crypto.randomUUID() },
  authorId: { type: "string", null: false },
  title: { type: "string", null: false },
  published: "boolean",
}) {
  author = belongsTo(Author); // its own authorId
  comments = hasMany(Comment, { dependent: "deleteAll" }); // Comment's articleId
}

export class Profile extends Model({
  id: { type: "integer", null: false },
  authorId: { type: "string", null: false },
  bio: "string",
}) {}

export class Comment extends Model({
  id: { type: "integer", null: false },
  articleId: { type: "string", null: false },
  body: { type: "string", null: false },
}) {}
// #endregion declare

// #region scoped
export class Blog extends Model({ id: { type: "integer", null: false } }) {
  // A scope for the association, as Rails' `has_many :posts, -> { … }`.
  recentPosts = hasMany(BlogPost, {
    scope: (q) => q.order({ createdAt: "desc" }).where({ draft: false }),
  });
}
// #endregion scoped

export class BlogPost extends Model({
  id: { type: "integer", null: false },
  blogId: { type: "integer", null: false },
  draft: { type: "boolean", null: false },
  createdAt: "datetime",
}) {}

export async function readExample(db: Database, articleId: string) {
  // #region read
  const article = await db.model(Article).find(articleId);
  const author = await article.author(); // an Author, or null
  const profile = await author?.profile(); // a Profile, or null
  const latest = await author?.articles().where({ published: true }).first();
  // #endregion read
  return { author, profile, latest };
}

export async function autosaveExample(db: Database) {
  // #region autosave
  const ada = db.model(Author).build({ name: "Ada" });
  ada.articles().build({ title: "Notes on the Analytical Engine" });
  ada.articles().build({ title: "Sketch of the Engine" });
  ada.profile.build({ bio: "Mathematician" });
  await ada.saveOrThrow(); // the author, both articles and the profile, in one batch
  // #endregion autosave
  return ada;
}

export async function createThroughExample(db: Database, articleId: string) {
  const article = await db.model(Article).find(articleId);
  // #region create-through
  const comment = await article.comments().create({ body: "Lovely." }); // articleId filled in
  // #endregion create-through
  return comment;
}

export async function writersExample(db: Database, ada: Author) {
  // #region writers
  const draft = db.model(Article).build({ title: "Untitled" });
  draft.author.set(ada); // sets draft.authorId, and ada is its loaded author
  await draft.save();

  const grace = db.model(Author).build({ name: "Grace" });
  const another = db.model(Article).build({ title: "COBOL" });
  another.author.set(grace); // a new author: saved first, when the article is
  await another.save();
  // #endregion writers
  return { draft, another, grace };
}

export async function preloadExample(db: Database) {
  // #region preload
  const authors = await db
    .model(Author)
    .includes("profile", { articles: "comments" }) // 4 queries, however many authors
    .toArray();

  for (const each of authors) {
    const articles = await each.articles().toArray(); // no query: already loaded
    console.log(each.name, articles.length, each.loaded("profile")?.bio);
  }
  // #endregion preload
  return authors;
}

export async function statementsExample(article: Article) {
  // #region statements
  await article.comments().deleteAll(); // one DELETE for the article's comments
  // #endregion statements
}

// #region self-referencing
export class Category extends Model({
  id: { type: "integer", null: false },
  parentId: "integer",
}) {
  static scopes = this.defineScopes({ top: (q) => q.where({ parentId: null }) });

  // Written out: TypeScript can't infer a field whose scope uses its own Model's scopes.
  children: HasMany<typeof Category> = hasMany(Category, {
    foreignKey: "parentId",
    scope: (q) => q.top(),
  });
  parent = belongsTo(Category, { foreignKey: "parentId" });
}
// #endregion self-referencing

export async function belongsToExample(db: Database, articleId: string, editor: Author) {
  // #region belongs-to
  const article = await db.model(Article).find(articleId);
  const author = await article.author(); // an Author, or null

  article.author.set(editor); // points it at another author: written when the article is saved
  await article.save();
  // #endregion belongs-to
  return author;
}

export async function hasManyExample(db: Database, authorId: string) {
  // #region has-many
  const author = await db.model(Author).find(authorId);
  const published = await author.articles().where({ published: true }).toArray(); // a Relation

  author.articles().build({ title: "Untitled" }); // saved with the author, with its key
  await author.save();

  await author.articles().where({ published: false }).deleteAll(); // bulk writes, scoped to the author
  // #endregion has-many
  return published;
}

export async function hasOneExample(db: Database, authorId: string) {
  // #region has-one
  const author = await db.model(Author).find(authorId);
  const profile = await author.profile(); // a Profile, or null

  if (profile === null) await author.profile.create({ bio: "Writer" }); // saved at once
  // #endregion has-one
  return profile;
}
