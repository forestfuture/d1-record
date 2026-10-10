// Asking which remote database a person means, before the console opens it (#104).
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { remoteDescription, type RemoteTarget } from "./database.ts";

/**
 * Names the remote database and asks for its name; true only when that is what is typed. Anything
 * else, a blank line, or the end of the input cancels. It reads one line and no more, so lines
 * pasted after the answer are dropped rather than run against a real database.
 */
export async function confirmRemote({
  input,
  output,
  binding,
  target,
}: {
  input: Readable;
  output: Writable;
  binding: string;
  target: RemoteTarget;
}): Promise<boolean> {
  const preview = target.preview
    ? "That is the config's preview_database_id, which Wrangler opens in place of database_id.\n"
    : "";
  output.write(
    `${remoteDescription(binding, target)}\n${preview}` +
      "What you change in the console is changed in this database, not a copy.\n" +
      "Type its name to continue, anything else cancels: ",
  );
  const reader = createInterface({ input, terminal: false });
  const typed = await new Promise<string>((resolve) => {
    reader.once("line", resolve);
    reader.once("close", () => resolve(""));
  });
  reader.close();
  return typed.trim() === target.name;
}
