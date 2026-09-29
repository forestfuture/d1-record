import { column, connect, sql } from "@forestfuture/d1-record";
import { Article, Author, Comment } from "./associations";

export async function examples(env: Env, articleId: string): Promise<unknown> {
  const db = connect(env.DB);
  // #region statements
  await db.model(Article).where({ published: false }).deleteAll().run();
  await db.model(Article).where({ id: articleId }).updateAll({ published: true }).run();
  await db
    .model(Article)
    .where({ id: articleId })
    .updateAll(sql`${column("title")} = upper(${column("title")})`)
    .run();
  const meta = await db.model(Comment).insert({ articleId, body: "First!" }).run();
  console.log(meta.changes, meta.last_row_id);
  // #endregion statements

  // #region insert-all
  await db
    .model(Comment)
    .insertAll([
      { articleId, body: "One" },
      { articleId, body: "Two" },
    ])
    .run();
  await db.model(Author).upsert({ id: "author-1", name: "Ada" }).run(); // insert, or update the name
  await db.model(Author).insert({ id: "author-1", name: "Ada" }, { onDuplicate: "skip" }).run();
  // #endregion insert-all

  // #region batch
  const authorId = crypto.randomUUID(); // generated in code, so rows can point at it
  await db.batch([
    db.model(Author).insert({ id: authorId, name: "Grace" }),
    db.model(Article).insert({ authorId, title: "Hello" }),
    db.model(Article).where({ published: false, authorId: "author-1" }).deleteAll(),
  ]);
  // #endregion batch

  // #region records
  const article = await db.model(Article).find(articleId);
  article.published = true;
  const author = db.model(Author).build({ name: "Hedy" });
  const old = await db.model(Author).find("author-1");

  const [savedArticle, savedAuthor] = await db.batch([
    article.toSave(),
    author.toSave(),
    old.toDestroy(), // with its dependents
    db.model(Comment).where({ articleId }).deleteAll(),
  ]);
  // #endregion records
  return [savedArticle, savedAuthor];
}
