import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { connect, IncompatibleRelation, Model, type Relation } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

class User extends Model({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
  suspended: { type: "boolean", null: false },
}) {
  static tableName = "users";
}

class Post extends Model({ id: "integer", title: "string" }) {
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
});
