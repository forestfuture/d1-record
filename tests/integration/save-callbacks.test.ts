import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { abort, connect, Model } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

const log: string[] = [];
const hooks: { beforeSave?: (user: User) => void; afterSave?: (user: User) => void } = {};

class User extends Model({
  id: { type: "integer", null: false },
  email: "string",
  role: "string",
}) {
  static tableName = "users";

  static {
    this.beforeValidation(() => void log.push("beforeValidation"));
    this.afterValidation(() => void log.push("afterValidation"));
    this.beforeSave((user) => {
      log.push("beforeSave");
      hooks.beforeSave?.(user);
    });
    this.beforeCreate(() => void log.push("beforeCreate"));
    this.beforeUpdate(() => void log.push("beforeUpdate"));
    this.afterCreate((user) => void log.push(`afterCreate (persisted: ${user.isPersisted()})`));
    this.afterUpdate(() => void log.push("afterUpdate"));
    this.afterSave((user) => {
      log.push("afterSave");
      hooks.afterSave?.(user);
    });
  }
}

describe("save callbacks", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  const users = () =>
    connect(binding, { onQuery: (event) => log.push(event.sql.split(" ")[0] ?? "") }).model(User);

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.prepare("DELETE FROM users").run();
    log.length = 0;
    delete hooks.beforeSave;
    delete hooks.afterSave;
  });

  test("creating runs the create callbacks around the INSERT", async () => {
    await users().create({ email: "a@example.com" });

    expect(log).toEqual([
      "beforeValidation",
      "afterValidation",
      "beforeSave",
      "beforeCreate",
      "INSERT",
      "afterCreate (persisted: true)",
      "afterSave",
    ]);
  });

  test("updating runs the update callbacks around the UPDATE", async () => {
    const user = await users().create({ email: "a@example.com" });
    log.length = 0;

    await user.update({ role: "admin" });

    expect(log).toEqual([
      "beforeValidation",
      "afterValidation",
      "beforeSave",
      "beforeUpdate",
      "UPDATE",
      "afterUpdate",
      "afterSave",
    ]);
  });

  test("a clean save runs every callback but sends no UPDATE", async () => {
    const user = await users().create({ email: "a@example.com" });
    log.length = 0;

    expect(await user.save()).toBe(true);

    expect(log).toEqual([
      "beforeValidation",
      "afterValidation",
      "beforeSave",
      "beforeUpdate",
      "afterUpdate",
      "afterSave",
    ]);
  });

  test("a change made in beforeSave is written", async () => {
    const user = await users().create({ email: "a@example.com" });
    hooks.beforeSave = (record) => {
      record.role = "member";
    };

    await user.save();

    expect(log).toContain("UPDATE");
    expect((await users().find(user.id)).role).toBe("member");
  });

  test("abort() in a before-save callback refuses the save: false, no write, nothing persisted", async () => {
    hooks.beforeSave = () => {
      throw abort("Signups are closed");
    };
    const user = users().build({ email: "a@example.com" });

    expect(await user.save()).toBe(false);

    expect(log).not.toContain("INSERT");
    expect(log).not.toContain("afterSave");
    expect(user.isNewRecord()).toBe(true);
    expect(user.abortReason).toBe("Signups are closed");
  });

  test("a change made in afterSave leaves the record dirty; no second write happens", async () => {
    hooks.afterSave = (record) => {
      record.role = "changed afterwards";
    };

    const user = await users().create({ email: "a@example.com" });

    expect(log.filter((entry) => entry === "INSERT" || entry === "UPDATE")).toEqual(["INSERT"]);
    expect(user.changed()).toEqual(["role"]);
  });
});
