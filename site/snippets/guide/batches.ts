import { batch, column, sql } from "@forestfuture/d1-record";
import { Article, Author, Comment } from "./associations";

export async function statementsExample(articleId: string) {
  // #region statements
  const deleted = await Comment.where({ articleId }).deleteAll(); // how many
  await Article.where({ id: articleId }).updateAll({ title: "Edited" });
  await Article.where({ id: articleId }).updateAll(
    sql`${column("title")} = upper(${column("title")})`,
  );
  const meta = await Comment.insert({ articleId, body: "First!" });
  console.log(deleted, meta.last_row_id);
  // #endregion statements
  return meta;
}

export async function insertAllExample(articleId: string) {
  // #region insert-all
  await Comment.insertAll([
    { articleId, body: "One" },
    { articleId, body: "Two" },
  ]);
  await Author.upsert({ id: "author-1", name: "Ada" }); // insert, or update the name
  await Author.insert({ id: "author-1", name: "Ada" }, { onDuplicate: "skip" });
  // #endregion insert-all
}

export async function batchExample() {
  // #region batch
  const authorId = crypto.randomUUID(); // generated in code, so rows can point at it
  await batch([
    Author.toInsert({ id: authorId, name: "Grace" }),
    Article.toInsert({ authorId, title: "Hello" }),
    Article.where({ authorId: "author-1" }).toDeleteAll(),
  ]);
  // #endregion batch
  return authorId;
}

export async function recordsExample(articleId: string, oldAuthorId: string) {
  // #region records
  const article = await Article.find(articleId);
  article.title = "Final";
  const author = Author.build({ name: "Hedy" });
  const old = await Author.find(oldAuthorId);

  const [savedArticle, savedAuthor] = await batch([
    article.toSave(),
    author.toSave(),
    old.toDestroy(), // with its dependents
    Comment.where({ articleId }).toDeleteAll(),
  ]);
  // #endregion records
  return { savedArticle, savedAuthor };
}
