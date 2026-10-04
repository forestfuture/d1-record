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

/** A cookie's value from a request's Cookie header. */
function cookie(request: Request, name: string): string | undefined {
  const pair = request.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((each) => each.startsWith(`${name}=`));
  return pair?.slice(name.length + 1);
}

async function handle(_request: Request): Promise<Response> {
  const user = await User.createOrThrow({ email: "ada@example.com" });
  return Response.json(await User.find(user.id)); // reads its own write
}

// #region session
// Middleware: each request reads at least as new as this browser's last write, from any replica.
async function withSession(request: Request, env: Env, next: () => Promise<Response>) {
  const bookmark = cookie(request, "d1-bookmark") ?? "first-unconstrained";
  const db = connect(env.DB, { session: bookmark });

  const response = await withDatabase(db, next); // every query in it uses the Session

  const latest = db.bookmark() ?? bookmark;
  response.headers.append(
    "set-cookie",
    `d1-bookmark=${latest}; Path=/; HttpOnly; Secure; SameSite=Lax`,
  );
  return response;
}

export default {
  fetch: (request, env) => withSession(request, env, () => handle(request)),
} satisfies ExportedHandler<Env>;
// #endregion session

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

export const timed = {
  async fetch(_request: Request, env: Env): Promise<Response> {
    // #region server-timing
    let queries = 0;
    let total = 0;
    const db = connect(env.DB, {
      onQuery({ durationMs }) {
        queries += 1;
        total += durationMs;
      },
    });

    const response = await withDatabase(db, async () =>
      Response.json(await User.active().toArray()),
    );
    // Shown in the browser's developer tools, under the request's Timing.
    response.headers.append(
      "server-timing",
      `d1;dur=${total.toFixed(1)};desc="${queries} queries"`,
    );
    return response;
    // #endregion server-timing
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
