import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { connect, Model, withDatabase } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";
import { startSession } from "../../cli/console/session.ts";
import { drive, terminalStreams, waitFor } from "../support/console.ts";

class Sample extends Model({
  id: { type: "integer", null: false },
  label: "string",
  quantity: "integer",
}) {
  static tableName = "samples";
}

// `d1-record console`: a REPL with the project's Models in scope (#104).
describe("the console session", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());
  // The project's library supplies withDatabase; here that is the repo's own.
  const session = () =>
    drive({
      scope: { Sample, db: connect(binding) },
      withDatabase: (run) => withDatabase(connect(binding), run),
    });
  beforeEach(async () => {
    await binding.prepare("DELETE FROM samples").run();
    await binding.prepare("INSERT INTO samples (id, label, quantity) VALUES (1, 'bolt', 36)").run();
  });

  test("a Model is in scope", async () => {
    const console = await session();

    expect(await console.send("Sample.tableName")).toBe("#=> 'samples'");
    await console.close();
  });

  test("a result prints after #=>", async () => {
    const console = await session();

    expect(await console.send("1 + 1")).toBe("#=> 2");
    await console.close();
  });

  test("await works at the top level, and a record prints as it does in a log", async () => {
    const console = await session();

    expect(await console.send("await db.model(Sample).find(1)")).toBe(
      "#=> Sample { id: 1, label: 'bolt', quantity: 36 }",
    );
    await console.close();
  });

  test("a const lives on across lines", async () => {
    const console = await session();

    await console.send("const sample = await db.model(Sample).find(1)");
    expect(await console.send("sample.label")).toBe("#=> 'bolt'");
    await console.close();
  });

  test("an error prints its message, not as a result", async () => {
    const console = await session();

    const failure = await console.send("await db.model(Sample).find(99)");

    expect(failure).toMatch(/RecordNotFound/);
    expect(failure).not.toContain("#=>");
    await console.close();
  });

  test("the session carries on after an error", async () => {
    const console = await session();

    await console.send("await db.model(Sample).find(99)");

    expect(await console.send("1 + 1")).toBe("#=> 2");
    await console.close();
  });

  test("a Model's statics need no database argument", async () => {
    const console = await session();

    expect(await console.send("await Sample.find(1)")).toBe(
      "#=> Sample { id: 1, label: 'bolt', quantity: 36 }",
    );
    await console.close();
  });

  test("a record's writes need no database argument", async () => {
    const console = await session();

    await console.send("const sample = await Sample.find(1)");
    expect(await console.send('await sample.update({ label: "nut" })')).toBe("#=> true");
    expect(await binding.prepare("SELECT label FROM samples WHERE id = 1").first("label")).toBe(
      "nut",
    );
    await console.close();
  });

  test("piped input runs in order, and the session outlasts the end of its input", async () => {
    const terminal = terminalStreams();
    const session = startSession({
      input: terminal.input,
      output: terminal.output,
      scope: { Sample, db: connect(binding) },
      withDatabase: (run) => withDatabase(connect(binding), run),
    });
    await terminal.ready();

    terminal.input.write("const sample = await Sample.find(1)\n");
    terminal.input.write("sample.label\n");
    terminal.input.write('await sample.update({ label: "nut" })\n');
    terminal.input.end();
    await session.closed;

    expect(terminal.transcript().match(/#=> .*/g)).toEqual([
      "#=> undefined",
      "#=> 'bolt'",
      "#=> true",
    ]);
    expect(await binding.prepare("SELECT label FROM samples WHERE id = 1").first("label")).toBe(
      "nut",
    );
  });

  test("a terminal gets colors in its results", async () => {
    const terminal = terminalStreams();
    const session = startSession({
      input: terminal.input,
      output: terminal.output,
      terminal: true,
      scope: { Sample },
      withDatabase: (run) => withDatabase(connect(binding), run),
    });
    terminal.input.write("1 + 1\n");
    await waitFor(() => terminal.transcript().includes("#=>"));
    terminal.input.end();
    await session.closed;

    expect(terminal.transcript()).toContain("#=> \u001b[33m2\u001b[39m");
  });

  describe.each(["quit", "exit"])("typing %s", (word) => {
    /** Types the lines, then ends the input; resolves "left", or "stayed" if it never closes. */
    async function leaves(...lines: string[]): Promise<string> {
      const terminal = terminalStreams();
      const session = startSession({
        input: terminal.input,
        output: terminal.output,
        scope: { Sample, db: connect(binding) },
        withDatabase: (run) => withDatabase(connect(binding), run),
      });
      await terminal.ready();
      terminal.input.write(`${lines.join("\n")}\n`);
      return Promise.race([
        session.closed.then(() => "left"),
        new Promise<string>((resolve) => setTimeout(() => resolve("stayed"), 3000)),
      ]);
    }

    test("leaves the console", async () => {
      expect(await leaves(word)).toBe("left");
    });

    test("runs no line typed after it", async () => {
      await leaves(word, 'await Sample.create({ id: 2, label: "late" })');

      expect(await binding.prepare("SELECT COUNT(*) AS n FROM samples").first("n")).toBe(1);
    });
  });

  test("a line typed key by key runs: completion's own evaluations don't block it", async () => {
    const terminal = terminalStreams();
    const session = startSession({
      input: terminal.input,
      output: terminal.output,
      terminal: true,
      scope: { Sample },
      withDatabase: (run) => withDatabase(connect(binding), run),
    });
    // The REPL evaluates the receiver of what is being typed (`try { await Sample } catch {}`)
    // to offer completions: a person typing gives it the time to, a burst or a pipe does not.
    for (const key of "await Sample.find(1)") {
      terminal.input.write(key);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    terminal.input.write("\n");
    await waitFor(() => terminal.transcript().includes("#=>"), 5);
    terminal.input.end();

    expect(terminal.transcript()).toContain("label");
    await session.closed;
  });
});
