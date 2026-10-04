import {
  batch,
  connect,
  Model,
  modelFor,
  withDatabase,
  type Database,
  type QueryListener,
} from "@forestfuture/d1-record";
import { tables } from "../db/schema";
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

// #region app-wide
// src/models/application-record.ts: every query, from every Model, whichever database runs it.
class Base extends Model.Base {
  static override binding = "DB";

  static override onQuery: QueryListener = ({ model, sql, durationMs, error }) => {
    console.log(`${model} ${durationMs.toFixed(1)}ms ${sql}`, error ?? "");
  };
}

export const ApplicationRecord = modelFor(tables, Base);
// #endregion app-wide

/** What your app exports as its Worker today: a framework's, or your own. */
declare const app: ExportedHandler<Env> & { fetch: NonNullable<ExportedHandler<Env>["fetch"]> };

// #region per-request
// src/worker.ts: one request's queries, tagged with its ID, as JSON lines for Workers Logs.
export const logged = {
  fetch(request, env, ctx) {
    const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
    const db = connect(env.DB, {
      onQuery: ({ model, sql, params, durationMs, error }) =>
        console.log(
          JSON.stringify({
            requestId,
            model,
            ms: Math.round(durationMs),
            sql,
            params,
            error: error instanceof Error ? error.message : undefined,
          }),
        ),
    });

    // Every query from a Model inside (Product.find, user.save(), …) goes through db.
    return withDatabase(db, () => app.fetch(request, env, ctx));
  },
} satisfies ExportedHandler<Env>;
// #endregion per-request

export const development = {
  fetch(request, env: Env & { LOG_SQL?: string }, ctx) {
    // #region development
    // LOG_SQL=1 in .dev.vars: logging in development only, nothing in production.
    const onQuery: QueryListener | undefined = env.LOG_SQL
      ? ({ model, sql, durationMs }) => console.log(`${model} ${durationMs.toFixed(1)}ms ${sql}`)
      : undefined;

    return withDatabase(connect(env.DB, { onQuery }), () => app.fetch(request, env, ctx));
    // #endregion development
  },
} satisfies ExportedHandler<Env & { LOG_SQL?: string }>;

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
