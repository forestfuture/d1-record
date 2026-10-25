import { Model, modelFor, withSession } from "@forestfuture/d1-record";

// What `d1-record schema` writes for two bindings: a schema and a base class for each.
const dbTables = {
  users: {
    attributes: { id: { type: "integer", null: false }, email: { type: "string", null: false } },
    primaryKey: "id",
  },
} as const;
const logsTables = {
  entries: {
    attributes: {
      id: { type: "integer", null: false },
      level: { type: "string", null: false },
      message: { type: "string", null: false },
    },
    primaryKey: "id",
  },
} as const;

class DbBase extends Model {
  static override binding = "DB";
}
class LogsBase extends Model {
  static override binding = "LOGS";
}

const DbRecord = modelFor(dbTables, DbBase);
const LogsRecord = modelFor(logsTables, LogsBase);

export class User extends DbRecord("users") {}
export class Entry extends LogsRecord("entries") {}

// #region request
// src/worker.ts: each Model queries its own database.
export default {
  async fetch(request) {
    const email = new URL(request.url).searchParams.get("email") ?? "";
    const user = await User.findByOrThrow({ email }); // on DB
    await Entry.create({ level: "info", message: `${user.email} signed in` }); // on LOGS
    return Response.json(user);
  },
} satisfies ExportedHandler<Env>;
// #endregion request

// #region sign-up
export async function signUp(email: string) {
  const user = await User.createOrThrow({ email }); // on DB first: if it throws, nothing is logged
  await Entry.create({ level: "info", message: `${user.email} signed up` }); // then on LOGS
  return user;
}
// #endregion sign-up

async function handle(request: Request): Promise<Response> {
  return Response.json(await signUp(new URL(request.url).searchParams.get("email") ?? ""));
}

// #region sessions
// src/worker.ts: each database's bookmark travels in its own cookie.
export const replicas = {
  fetch: (request, env) =>
    withSession(request, env.DB, () =>
      withSession(request, env.LOGS, { cookie: "logs-bookmark" }, () => handle(request)),
    ),
} satisfies ExportedHandler<Env>;
// #endregion sessions
