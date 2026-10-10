import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { loadProject } from "../../cli/console/project.ts";
import { scratchDirs } from "../support/scratch.ts";

// The library resolves, as an app's does, from a tsconfig `paths` entry (here to this repo's source).
const library = new URL("../../src/index.ts", import.meta.url).pathname;
const scratch = scratchDirs();

/** A throwaway project: its files, by path, and a tsconfig that finds the library. */
function project(files: Record<string, string>, outsideTheRepo = false): string {
  const dir = scratch("console-", outsideTheRepo);
  const all = {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: { "@forestfuture/d1-record": [library], "@/*": ["./src/*"] },
      },
    }),
    ...files,
  };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

const applicationRecord = `
import { modelFor } from "@forestfuture/d1-record";
export const ApplicationRecord = modelFor({
  users: { attributes: { id: "integer", name: "string" }, primaryKey: "id" },
  posts: { attributes: { id: "integer", title: "string" }, primaryKey: "id" },
} as const);
`;

describe("loading a project's Models for the console", () => {
  test("every Model class in the folder, whatever its imports look like", async () => {
    const cwd = project({
      "src/models/application-record.ts": applicationRecord,
      "src/models/user.ts": `
        import type { Model } from "@forestfuture/d1-record";
        import { ApplicationRecord } from "./application-record";
        import { greeting } from "@/lib/greeting";
        export class User extends ApplicationRecord("users") { static greeting = greeting; }
        export type UserModel = typeof User & Model;
      `,
      "src/models/post.ts": `
        import { ApplicationRecord } from "./application-record";
        export class Post extends ApplicationRecord("posts") {}
      `,
      "src/lib/greeting.ts": `export const greeting: string = "hello";`,
    });

    const loaded = await loadProject(cwd);

    if (typeof loaded === "string") throw new Error(loaded);
    expect(Object.keys(loaded.models).sort()).toEqual(["Post", "User"]);
    expect((loaded.models.User as unknown as { greeting: string }).greeting).toBe("hello");
  });

  test("--models can name one file of Models", async () => {
    const cwd = project({
      "src/models/application-record.ts": applicationRecord,
      "src/models.ts": `
        import { ApplicationRecord } from "./models/application-record";
        export class User extends ApplicationRecord("users") {}
        export class Post extends ApplicationRecord("posts") {}
      `,
    });

    const loaded = await loadProject(cwd, "src/models.ts");

    if (typeof loaded === "string") throw new Error(loaded);
    expect(Object.keys(loaded.models).sort()).toEqual(["Post", "User"]);
  });

  describe("says why a project can't be loaded", () => {
    test("no models folder", async () => {
      expect(await loadProject(project({}))).toBe(
        "No Models at src/models (run d1-record g model, or pass --models)",
      );
    });

    test("a folder with no Models in it", async () => {
      const cwd = project({ "src/models/notes.ts": "export const notes = 1;" });

      expect(await loadProject(cwd)).toBe(
        "No Models in src/models (run d1-record g model, or pass --models)",
      );
    });

    test("a file that throws, by name", async () => {
      const cwd = project({ "src/models/broken.ts": 'throw new Error("boom");' });

      expect(await loadProject(cwd)).toBe("Couldn't load src/models/broken.ts: boom");
    });

    test("a library that fails to load is reported as that, not as missing", async () => {
      const cwd = project(
        {
          "package.json": '{ "name": "shop", "type": "module" }',
          "tsconfig.json": "{}",
          "node_modules/@forestfuture/d1-record/package.json":
            '{ "name": "@forestfuture/d1-record", "type": "module", "exports": "./index.js" }',
          "node_modules/@forestfuture/d1-record/index.js": 'throw new Error("boom");',
          "src/models/user.ts": "export class User {}",
        },
        true,
      );

      expect(await loadProject(cwd)).toBe("Couldn't load @forestfuture/d1-record: boom");
    });

    test("a project without the library", async () => {
      // Outside the repo, whose tsconfig paths would otherwise find the library for it.
      const cwd = project(
        {
          "package.json": '{ "name": "shop", "type": "module" }',
          "tsconfig.json": "{}",
          "src/models/user.ts": "export class User {}",
        },
        true,
      );

      expect(await loadProject(cwd)).toMatch(/^@forestfuture\/d1-record isn't installed here/);
    });
  });

  describe("reloading", () => {
    /** A loaded project, and the folder it is in, for edits between loads. */
    async function loaded() {
      const cwd = project({
        "src/models/application-record.ts": applicationRecord,
        "src/models/user.ts": `
          import { ApplicationRecord } from "./application-record";
          import { greeting } from "@/lib/greeting";
          export class User extends ApplicationRecord("users") { static greeting = greeting; }
        `,
        "src/lib/greeting.ts": `export const greeting: string = "hello";`,
      });
      const first = await loadProject(cwd);
      if (typeof first === "string") throw new Error(first);
      return { cwd, first };
    }

    test("picks up an edit to a Model's file", async () => {
      const { cwd, first } = await loaded();
      writeFileSync(
        join(cwd, "src/models/user.ts"),
        `
          import { ApplicationRecord } from "./application-record";
          export class User extends ApplicationRecord("users") { static edited = true; }
        `,
      );

      const again = await first.reload();

      if (typeof again === "string") throw new Error(again);
      expect((again.User as unknown as { edited: boolean }).edited).toBe(true);
    });

    test("picks up an edit to a file a Model imports", async () => {
      const { cwd, first } = await loaded();
      writeFileSync(join(cwd, "src/lib/greeting.ts"), `export const greeting = "bonjour";`);

      const again = await first.reload();

      if (typeof again === "string") throw new Error(again);
      expect((again.User as unknown as { greeting: string }).greeting).toBe("bonjour");
    });

    test("finds a Model file added since", async () => {
      const { cwd, first } = await loaded();
      writeFileSync(
        join(cwd, "src/models/post.ts"),
        `
          import { ApplicationRecord } from "./application-record";
          export class Post extends ApplicationRecord("posts") {}
        `,
      );

      const again = await first.reload();

      if (typeof again === "string") throw new Error(again);
      expect(Object.keys(again).sort()).toEqual(["Post", "User"]);
    });

    test("drops a Model whose file was removed", async () => {
      const { cwd, first } = await loaded();
      writeFileSync(
        join(cwd, "src/models/post.ts"),
        `
          import { ApplicationRecord } from "./application-record";
          export class Post extends ApplicationRecord("posts") {}
        `,
      );
      rmSync(join(cwd, "src/models/user.ts"));

      const again = await first.reload();

      if (typeof again === "string") throw new Error(again);
      expect(Object.keys(again)).toEqual(["Post"]);
    });

    test.skipIf(process.platform === "win32")(
      "picks up an edit when the project's folder is reached through a symlink",
      async () => {
        const { cwd } = await loaded();
        const link = `${cwd}-link`;
        symlinkSync(cwd, link);
        const first = await loadProject(link);
        if (typeof first === "string") throw new Error(first);
        writeFileSync(
          join(cwd, "src/models/user.ts"),
          `
            import { ApplicationRecord } from "./application-record";
            export class User extends ApplicationRecord("users") { static edited = true; }
          `,
        );

        const again = await first.reload();
        rmSync(link);

        if (typeof again === "string") throw new Error(again);
        expect((again.User as unknown as { edited: boolean }).edited).toBe(true);
      },
    );

    test("keeps the library: a reloaded Model is still a Model of the same library", async () => {
      const { first } = await loaded();

      const again = await first.reload();

      if (typeof again === "string") throw new Error(again);
      const User = again.User as { prototype: object };
      expect(User.prototype instanceof first.library.Model.Base).toBe(true);
    });

    test("says which file fails to load", async () => {
      const { cwd, first } = await loaded();
      writeFileSync(join(cwd, "src/models/user.ts"), 'throw new Error("mid-edit");');

      expect(await first.reload()).toBe("Couldn't load src/models/user.ts: mid-edit");
    });

    test("leaves the loaded Models as they were when a file fails", async () => {
      const { cwd, first } = await loaded();
      const before = first.models.User;
      writeFileSync(join(cwd, "src/models/user.ts"), 'throw new Error("mid-edit");');
      await first.reload();

      expect(first.models.User).toBe(before);
    });

    test("loads again once the file is fixed", async () => {
      const { cwd, first } = await loaded();
      writeFileSync(join(cwd, "src/models/user.ts"), 'throw new Error("mid-edit");');
      await first.reload();
      writeFileSync(
        join(cwd, "src/models/user.ts"),
        `
          import { ApplicationRecord } from "./application-record";
          export class User extends ApplicationRecord("users") { static fixed = true; }
        `,
      );

      const again = await first.reload();

      if (typeof again === "string") throw new Error(again);
      expect((again.User as unknown as { fixed: boolean }).fixed).toBe(true);
    });
  });
});
