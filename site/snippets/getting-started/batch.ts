import type { Database } from "@forestfuture/d1-record";
import { Post, type User } from "./models";

export async function publishDraftsAndRemove(db: Database, user: User): Promise<void> {
  // #region batch
  await db.batch([
    db.model(Post).where({ publishedAt: null }).toUpdateAll({ publishedAt: new Date() }),
    user.toDestroy(), // and its posts, since posts are dependent: "destroy"
  ]);
  // #endregion batch
}
