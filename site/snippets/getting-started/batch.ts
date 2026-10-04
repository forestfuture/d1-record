import { batch } from "@forestfuture/d1-record";
import { Post, type User } from "./models";

export async function publishDraftsAndRemove(user: User): Promise<void> {
  // #region batch
  await batch([
    Post.where({ publishedAt: null }).toUpdateAll({ publishedAt: new Date() }),
    user.toDestroy(), // and its posts, since posts are dependent: "destroy"
  ]);
  // #endregion batch
}
