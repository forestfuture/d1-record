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
  const db = connect(binding, { session: cookie(request, cookieName) ?? "first-unconstrained" });
  const response = await withDatabase(db, () => fn(db));
  const latest = db.bookmark();
  if (latest !== null) {
    response.headers.append(
      "set-cookie",
      `${cookieName}=${latest}; Path=/; HttpOnly; Secure; SameSite=Lax`,
    );
  }
  return response;
}

/** The value of the request's cookie named `name`, if it sent one. */
function cookie(request: Request, name: string): string | undefined {
  for (const pair of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = pair.split("=");
    if (key?.trim() === name) return value.join("=").trim();
  }
  return undefined;
}
