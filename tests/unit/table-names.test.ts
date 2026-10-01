import { describe, expect, test } from "vite-plus/test";
import { connect, InvalidModel, Model } from "../../src/index.ts";

const db = connect({} as never);

/** A Model class with this exact class name, as `class <name> extends Model(…)` makes. */
function modelNamed(name: string) {
  return { [name]: class extends Model({ id: "integer" }) {} }[name]!;
}

describe("inferred table names", () => {
  // Rails' tableize: underscore, then pluralize by Active Support's English inflections
  // (cases from Rails' inflector tests).
  test.each([
    ["User", "users"],
    ["BlogPost", "blog_posts"],
    ["APIKey", "api_keys"],
    ["Search", "searches"],
    ["Switch", "switches"],
    ["Box", "boxes"],
    ["Process", "processes"],
    ["Address", "addresses"],
    ["Wish", "wishes"],
    ["Category", "categories"],
    ["Query", "queries"],
    ["Day", "days"],
    ["Movie", "movies"],
    ["Archive", "archives"],
    ["Index", "indices"],
    ["Vertex", "vertices"],
    ["Matrix", "matrices"],
    ["MatrixFu", "matrix_fus"],
    ["Wife", "wives"],
    ["Safe", "saves"],
    ["Half", "halves"],
    ["Dwarf", "dwarves"],
    ["Basis", "bases"],
    ["Analysis", "analyses"],
    ["Datum", "data"],
    ["Medium", "media"],
    ["Quiz", "quizzes"],
    ["Bus", "buses"],
    ["Status", "statuses"],
    ["Alias", "aliases"],
    ["Octopus", "octopi"],
    ["Axis", "axes"],
    ["Ox", "oxen"],
    ["Mouse", "mice"],
    ["House", "houses"],
    ["Buffalo", "buffaloes"],
    ["Tomato", "tomatoes"],
    ["Photo", "photos"],
    ["Person", "people"],
    ["Salesperson", "salespeople"],
    ["Man", "men"],
    ["Woman", "women"],
    ["Child", "children"],
    ["NodeChild", "node_children"],
    ["Move", "moves"],
    ["Zombie", "zombies"],
    ["Sheep", "sheep"],
    ["Fish", "fish"],
    ["Series", "series"],
    ["Species", "species"],
    ["Equipment", "equipment"],
    ["Information", "information"],
    ["Police", "police"],
    ["Rice", "rice"],
    ["Price", "prices"],
    ["News", "news"],
  ])("%s → %s", (className, table) => {
    expect(modelNamed(className).tableName).toBe(table);
  });

  test("an explicit tableName wins", () => {
    class Person extends Model({ id: "integer" }) {
      static tableName = "humans";
    }

    expect(Person.tableName).toBe("humans");
  });

  test("a subclass shares its parent's table, inferred or explicit, unless it declares its own", () => {
    class User extends Model({ id: "integer" }) {}
    class Admin extends User {}
    class Archived extends User {
      static tableName = "archived_users";
    }
    class Account extends Model({ id: "integer" }) {
      static tableName = "billing_accounts";
    }
    class Business extends Account {}

    expect([Admin.tableName, Archived.tableName, Business.tableName]).toEqual([
      "users",
      "archived_users",
      "billing_accounts",
    ]);
  });

  test("a class renamed by a bundler infers from the name it has", () => {
    // What a minifier without keep_names does: the class is now called e.
    const e = class extends Model({ id: "integer" }) {};

    expect(e.tableName).toBe("es");
  });

  test("assigning tableName sets it for that class, as compiled class fields and static blocks do", () => {
    class User extends Model({ id: "integer" }) {}
    class Admin extends User {}
    class Member extends Model({ id: "integer" }) {
      static {
        this.tableName = "people";
      }
    }

    // What `static tableName = "…"` compiles to without useDefineForClassFields.
    User.tableName = "members";
    Admin.tableName = "admins";

    expect([User.tableName, Admin.tableName, Member.tableName]).toEqual([
      "members",
      "admins",
      "people",
    ]);
  });

  test("a class with no name to infer from must declare its tableName", () => {
    const anonymous = [class extends Model({ id: "integer" }) {}][0]!;
    const defaultExport = { default: class extends Model({ id: "integer" }) {} }.default;
    const direct = Model({ id: "integer" });

    for (const model of [anonymous, defaultExport, direct]) {
      expect(() => db.model(model)).toThrow(InvalidModel);
      expect(() => db.model(model)).toThrow(
        /has no class name to infer its table from; set static tableName/,
      );
    }
  });
});
