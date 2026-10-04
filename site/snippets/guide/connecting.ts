import { batch, connect, withDatabase, type Database } from "@forestfuture/d1-record";
import { Post, User } from "../getting-started/models";

export const plain = {
  async fetch(_request: Request, _env: Env): Promise<Response> {
    // #region binding
    // No setup: each Model queries its binding (static binding = "DB") during the request.
    const user = await User.findByOrThrow({ email: "ada@example.com" });
    const posts = await Post.where({ userId: user.id }).order({ id: "desc" }).toArray();
    // #endregion binding
    return Response.json(posts);
  },
} satisfies ExportedHandler<Env>;

export const withSession = {
  async fetch(request: Request, env: Env): Promise<Response> {
    // #region session
    // Read at least as new as this client's last request wrote, or from any replica.
    const bookmark = request.headers.get("x-d1-bookmark") ?? "first-unconstrained";
    const db = connect(env.DB, { session: bookmark });

    // Every query inside, from any Model on env.DB, goes through this request's session.
    const found = await withDatabase(db, async () => {
      const user = await User.createOrThrow({ email: "ada@example.com" });
      return User.find(user.id); // reads its own write
    });

    const response = Response.json(found);
    response.headers.set("x-d1-bookmark", db.bookmark() ?? bookmark);
    return response;
    // #endregion session
  },
} satisfies ExportedHandler<Env>;

export const observed = {
  async fetch(request: Request, env: Env): Promise<Response> {
    // #region on-query
    const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
    const db = connect(env.DB, {
      onQuery({ sql, params, durationMs, error }) {
        console.log(requestId, `${durationMs.toFixed(1)}ms`, sql, params, error ?? "");
      },
    });

    return withDatabase(db, async () => Response.json(await User.count()));
    // #endregion on-query
  },
} satisfies ExportedHandler<Env>;

export async function inATest(binding: D1Database): Promise<void> {
  // #region test
  // Outside a Worker there's no env.DB to find, so a test names its database.
  await withDatabase(connect(binding), async () => {
    await User.create({ email: "ada@example.com" });
    console.log(await User.count()); // 1
  });
  // #endregion test
}

export const explicit = {
  async fetch(_request: Request, env: Env): Promise<Response> {
    // #region explicit
    const db = connect(env.DB);
    const user = await db.model(User).findByOrThrow({ email: "ada@example.com" });
    // #endregion explicit
    // #region models
    const models = db.models({ User, Post });
    const posts = await models.Post.where({ userId: user.id }).toArray();
    // #endregion models
    return Response.json(posts);
  },
} satisfies ExportedHandler<Env>;

export async function batched(): Promise<void> {
  // #region batch
  const user = User.build({ email: "grace@example.com" });
  const post = Post.build({ id: 1, userId: user.id, title: "Hello" });

  // Atomic: all written, or none.
  await batch([user.toSave(), post.toSave(), Post.where({ userId: "old" }).toDeleteAll()]);
  // #endregion batch
}

export function several(env: Env & { LOGS: D1Database }, handle: () => Promise<Response>) {
  // #region several
  const databases: Database[] = [connect(env.DB, { session: "first-primary" }), connect(env.LOGS)];
  return withDatabase(databases, handle); // each Model uses the one on its binding
  // #endregion several
}
