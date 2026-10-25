import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import {
  connect,
  IncompatibleRelation,
  Model,
  RecordNotFound,
  type QueryEvent,
  type Relation,
} from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
  suspended: { type: "boolean", null: false },
}) {
  static tableName = "users";
}

class Post extends Model.define({ id: "integer", title: "string" }) {
  static tableName = "posts";
}

const ids = async (relation: Relation<User>) => (await relation.toArray()).map((user) => user.id);

describe("relation composition", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
    await binding
      .prepare(
        `INSERT INTO users (id, email, role, suspended) VALUES
           (1, 'a@example.com', 'admin',  0),
           (2, 'b@example.com', 'member', 1),
           (3, 'c@example.com', 'author', 0),
           (4, 'd@example.com', 'admin',  1)`,
      )
      .run();
  });
  afterAll(() => dispose());

  test("or matches rows matching either relation's conditions, each side grouped", async () => {
    const users = connect(binding).model(User).order({ id: "asc" });

    const activeAdminsOrAuthors = users
      .where({ role: "admin", suspended: false })
      .or(users.where({ role: "author" }));

    expect(await ids(activeAdminsOrAuthors)).toEqual([1, 3]);
  });

  test("or rejects relations that differ in anything but their conditions", () => {
    const db = connect(binding);
    const users = db.model(User);

    expect(() => users.where({ role: "admin" }).or(users.limit(1))).toThrow(IncompatibleRelation);
    expect(() => users.or(users.order({ id: "desc" }))).toThrow(/order/);
    // @ts-expect-error a relation of another model
    expect(() => users.or(db.model(Post))).toThrow(IncompatibleRelation);
  });

  test("merge ANDs conditions, and the argument's explicit clauses replace the receiver's", async () => {
    const users = connect(binding).model(User);
    const base = users.where({ suspended: false }).order({ id: "desc" }).limit(10);

    const merged = base.merge(users.where({ role: "admin" }));
    const reordered = base.merge(users.order({ id: "asc" }).limit(1));

    expect(await ids(merged)).toEqual([1]);
    expect(await ids(reordered)).toEqual([1]);
    expect(await ids(base.merge(users))).toEqual([3, 1]);
  });

  test("merge rejects a relation of another Model", () => {
    const db = connect(binding);

    // @ts-expect-error a relation of another model
    expect(() => db.model(User).merge(db.model(Post))).toThrow(IncompatibleRelation);
  });

  test("none never touches D1, and every terminal operation returns an empty result", async () => {
    const queries: QueryEvent[] = [];
    const nothing = connect(binding, { onQuery: (event) => queries.push(event) })
      .model(User)
      .none()
      .where({ role: "admin" })
      .order({ id: "asc" });

    expect(await nothing.toArray()).toEqual([]);
    expect(await nothing.count()).toBe(0);
    expect(await nothing.exists()).toBe(false);
    expect(await nothing.first()).toBeNull();
    expect(await nothing.last()).toBeNull();
    expect(await nothing.take()).toBeNull();
    expect(await nothing.findBy({ id: 1 })).toBeNull();
    expect(await nothing.pluck("id")).toEqual([]);
    await expect(nothing.find(1)).rejects.toThrow(RecordNotFound);
    expect(queries).toHaveLength(0);
  });

  test("none drops out of or from either side, and merging with none gives none", async () => {
    const users = connect(binding).model(User).order({ id: "asc" });
    const admins = users.where({ role: "admin" });

    expect(await ids(users.none().or(admins))).toEqual([1, 4]);
    expect(await ids(admins.or(users.none()))).toEqual([1, 4]);
    expect(await ids(admins.merge(users.none()))).toEqual([]);
  });
});
