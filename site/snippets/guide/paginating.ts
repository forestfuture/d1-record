import { Model } from "@forestfuture/d1-record";
import { Post } from "../getting-started/models";

// #region paginate
export async function listPosts(request: Request): Promise<Response> {
  const page = new URL(request.url).searchParams.get("page");
  const posts = await Post.order({ publishedAt: "desc" }).paginate({ page, perPage: 20 });
  return Response.json(posts); // { records, page, perPage, total, totalPages, hasNext, hasPrevious }
}
// #endregion paginate

export async function countless(): Promise<unknown> {
  // #region countless
  const posts = await Post.order({ publishedAt: "desc" }).paginate({ page: 2, count: false });
  const more = posts.hasNext; // whether page 3 has any posts
  // #endregion countless
  return { ...posts, more };
}

// #region per-page
export class Base extends Model.Base {
  static override perPage = 20; // when paginate() isn't given a perPage
  static override maxPerPage = 50; // a larger perPage is capped at this
}
// #endregion per-page
