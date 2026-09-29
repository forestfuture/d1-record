import { between, column, connect, gte, lt, sql } from "@forestfuture/d1-record";
import { Post } from "../getting-started/models";
import { User } from "./models";

export async function examples(env: Env, since: Date, until: Date): Promise<unknown> {
  const db = connect(env.DB);
  // #region relation
  const admins = db.model(User).where({ role: "admin" }).order({ createdAt: "desc" });
  const firstTen = admins.limit(10); // a new Relation; admins is unchanged
  const users = await firstTen.toArray(); // the query runs here
  // #endregion relation

  // #region where
  db.model(User).where({ role: "admin", isActive: true }); // role = ? AND is_active = ?
  db.model(User).where({ role: null }); // role IS NULL
  db.model(User).where({ role: ["admin", "editor"] }); // role IN (…), any number of values
  db.model(User).whereNot({ role: "admin" }); // NOT (role = ?)
  db.model(User)
    .where({ role: "admin" })
    .or(db.model(User).where({ isActive: false }));
  // #endregion where

  // #region comparisons
  db.model(Post).where({ id: gte(100) }); // id >= 100
  db.model(User).where({ createdAt: lt(since) }); // created_at < since
  db.model(User).where({ createdAt: between(since, until) }); // both ends included
  db.model(User).where({ createdAt: between(since, until, { excludeEnd: true }) });
  // #endregion comparisons

  // #region sql
  const email = "Ada@Example.com";
  db.model(User).where(sql`lower(${column("email")}) = lower(${email})`);
  // #endregion sql

  // #region order
  db.model(User).order({ role: "asc", createdAt: "desc" });
  db.model(User).order({ role: { direction: "asc", nulls: "last" } });
  db.model(User).order(sql`lower(${column("email")})`);
  db.model(User).order({ role: "asc" }).reorder({ email: "asc" }); // replaces the order
  db.model(User).order({ createdAt: "desc" }).limit(20).offset(40); // page 3
  // #endregion order

  // #region terminal
  const all = await db.model(User).toArray();
  const user = await db.model(User).find("3b241101-e2bb-4255-8caf-4136c566a962"); // or RecordNotFound
  const two = await db.model(User).find(["id-1", "id-2"]); // in the ids' order
  const byEmail = await db.model(User).findBy({ email: "ada@example.com" }); // or null
  const oldest = await db.model(User).first(); // by primary key, unless ordered
  const newest = await db.model(User).order({ createdAt: "asc" }).last(); // order reversed
  const any = await db.model(User).take(); // no ordering at all
  const emails = await db.model(User).pluck("email"); // string[]
  const pairs = await db.model(User).pluck("id", "email"); // [string, string][]
  const admins2 = await db.model(User).where({ role: "admin" }).count();
  const hasAdmins = await db.model(User).exists({ role: "admin" });
  // #endregion terminal

  // #region select
  const partial = await db.model(User).select("email").toArray();
  console.log(partial[0]?.email); // loaded
  console.log(partial[0]?.id); // the primary key is always loaded too
  // partial[0]?.role would throw MissingAttribute: it wasn't selected
  const roles = await db.model(User).select("role").distinct().pluck("role");
  // #endregion select

  // #region none
  const nothing = await db.model(User).none().where({ role: "admin" }).toArray(); // [], no query
  // #endregion none

  return [
    users,
    all,
    user,
    two,
    byEmail,
    oldest,
    newest,
    any,
    emails,
    pairs,
    admins2,
    hasAdmins,
    roles,
    nothing,
  ];
}
