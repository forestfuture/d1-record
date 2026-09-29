import { connect } from "@forestfuture/d1-record";
import { Post, User } from "../getting-started/models";

export const plain = {
  async fetch(_request: Request, env: Env): Promise<Response> {
    // #region connect
    const db = connect(env.DB);
    const user = await db.model(User).findByOrThrow({ email: "ada@example.com" });
    // #endregion connect
    // #region models
    const models = db.models({ User, Post });
    const posts = await models.Post.where({ userId: user.id }).toArray();
    // #endregion models
    return Response.json(posts);
  },
} satisfies ExportedHandler<Env>;

export const withSession = {
  async fetch(request: Request, env: Env): Promise<Response> {
    // #region session
    // Read at least as new as this client's last request wrote, or from any replica.
    const bookmark = request.headers.get("x-d1-bookmark") ?? "first-unconstrained";
    const db = connect(env.DB, { session: bookmark });

    const user = await db.model(User).createOrThrow({ email: "ada@example.com" });
    const found = await db.model(User).find(user.id); // reads its own write

    const response = Response.json(found);
    response.headers.set("x-d1-bookmark", db.bookmark() ?? bookmark);
    return response;
    // #endregion session
  },
} satisfies ExportedHandler<Env>;

export const observed = {
  async fetch(_request: Request, env: Env): Promise<Response> {
    // #region on-query
    const db = connect(env.DB, {
      onQuery({ sql, params, durationMs, error }) {
        console.log(`${durationMs.toFixed(1)}ms`, sql, params, error ?? "");
      },
    });
    // #endregion on-query
    return Response.json(await db.model(User).count());
  },
} satisfies ExportedHandler<Env>;
