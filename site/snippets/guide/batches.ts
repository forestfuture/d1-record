import { column, sql, type Database } from "@forestfuture/d1-record";
import { Article, Author, Comment } from "./associations";

export async function statementsExample(db: Database, articleId: string) {
  // #region statements
  await db.model(Article).where({ published: false }).deleteAll();
  await db.model(Article).where({ id: articleId }).updateAll({ published: true });
  await db
    .model(Article)
    .where({ id: articleId })
    .updateAll(sql`${column("title")} = upper(${column("title")})`);
  const meta = await db.model(Comment).insert({ articleId, body: "First!" });
  console.log(meta.changes, meta.last_row_id);
  // #endregion statements
  return meta;
}

export async function insertAllExample(db: Database, articleId: string) {
  // #region insert-all
  await db.model(Comment).insertAll([
    { articleId, body: "One" },
    { articleId, body: "Two" },
  ]);
  await db.model(Author).upsert({ id: "author-1", name: "Ada" }); // insert, or update the name
  await db.model(Author).insert({ id: "author-1", name: "Ada" }, { onDuplicate: "skip" });
  // #endregion insert-all
}

export async function batchExample(db: Database) {
  // #region batch
  const authorId = crypto.randomUUID(); // generated in code, so rows can point at it
  await db.batch([
    db.model(Author).toInsert({ id: authorId, name: "Grace" }),
    db.model(Article).toInsert({ authorId, title: "Hello" }),
    db.model(Article).where({ published: false, authorId: "author-1" }).toDeleteAll(),
  ]);
  // #endregion batch
  return authorId;
}

export async function recordsExample(db: Database, articleId: string, oldAuthorId: string) {
  // #region records
  const article = await db.model(Article).find(articleId);
  article.published = true;
  const author = db.model(Author).build({ name: "Hedy" });
  const old = await db.model(Author).find(oldAuthorId);

  const [savedArticle, savedAuthor] = await db.batch([
    article.toSave(),
    author.toSave(),
    old.toDestroy(), // with its dependents
    db.model(Comment).where({ articleId }).toDeleteAll(),
  ]);
  // #endregion records
  return { savedArticle, savedAuthor };
}
