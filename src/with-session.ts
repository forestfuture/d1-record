// `withSession`: one request's D1 Session, started from the bookmark it carries, and the bookmark sent back (#220).
import { withDatabase } from "./current-database.ts";
import { connect, type Database } from "./database.ts";

const cookieName = "d1-bookmark";

/**
 * Runs `fn` with a Database whose Session starts from the request's bookmark, so the request
 * reads at least as new as the user's last write, from any replica, and sets the Session's
 * latest bookmark on the response it returns.
 */
export async function withSession(
  request: Request,
  binding: D1Database,
  fn: (db: Database) => Response | Promise<Response>,
): Promise<Response> {
  const bookmark = cookie(request, cookieName);
  const db = connect(binding, { session: bookmark ?? "first-unconstrained" });
  const response = await withDatabase(db, () => fn(db));
  // Before its first query, a Session may have no bookmark of its own: the request's still holds.
  const latest = db.bookmark() ?? bookmark;
  if (latest === undefined) return response;
  return withHeader(
    response,
    "set-cookie",
    `${cookieName}=${latest}; Path=/; HttpOnly; Secure; SameSite=Lax`,
  );
}

/**
 * `response` with the header appended. A response whose headers can't change (one from
 * `fetch()` or `Response.redirect()`) is copied first; any other is returned as it is, so a
 * WebSocket upgrade keeps its socket.
 */
function withHeader(response: Response, name: string, value: string): Response {
  try {
    response.headers.append(name, value);
    return response;
  } catch {
    const copy = new Response(response.body, response);
    copy.headers.append(name, value);
    return copy;
  }
}

/** The value of the request's cookie named `name`, if it sent one that isn't empty. */
function cookie(request: Request, name: string): string | undefined {
  for (const pair of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = pair.split("=");
    if (key?.trim() === name) return value.join("=").trim() || undefined;
  }
  return undefined;
}
