import {
  belongsTo,
  type Database,
  hasMany,
  hasOne,
  Model,
  type Relation,
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
  published: { type: "boolean", null: false, default: () => false },
  createdAt: "datetime",
}) {
  author = belongsTo(Author); // its own authorId
  comments = hasMany(Comment, { dependent: "deleteAll" }); // Comment's articleId

  static scopes = this.defineScopes({
    published: (q) => q.where({ published: true }),
  });
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
    scope: (q: Relation<BlogPost>) => q.order({ createdAt: "desc" }).where({ draft: false }),
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
  const latest = await author?.articles().published().order({ createdAt: "desc" }).first();
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
  await article.comments().deleteAll().run(); // one DELETE for the article's comments
  // #endregion statements
}
