import { underscore } from "./naming.ts";

/** One validation failure: which attribute (or `"base"`), what kind, and the message. */
export interface ValidationError {
  attribute: string;
  type: string;
  message: string;
}

/** "createdAt" → "Created at" */
function displayName(attribute: string): string {
  const words = underscore(attribute).replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** @internal The library's key for emptying an errors collection. */
export const clearErrors = Symbol("clearErrors");

/** A record's validation errors: `record.errors`. Cleared at the start of each validation run. */
export class Errors {
  #entries: ValidationError[] = [];

  /** Adds an error; `type` defaults to `"invalid"`. Use `"base"` for the record as a whole. */
  add(attribute: string, message: string, options: { type?: string } = {}): void {
    this.#entries.push({ attribute, type: options.type ?? "invalid", message });
  }

  /** The messages for one attribute (always an array). */
  get(attribute: string): string[] {
    return this.#entries
      .filter((entry) => entry.attribute === attribute)
      .map((entry) => entry.message);
  }

  /** Every message with its attribute's display name first: "Email can't be blank". */
  fullMessages(): string[] {
    return this.#entries.map(({ attribute, message }) =>
      attribute === "base" ? message : `${displayName(attribute)} ${message}`,
    );
  }

  /** Every error as `{ attribute, type, message }` (copies). */
  toArray(): ValidationError[] {
    return this.#entries.map((entry) => ({ ...entry }));
  }

  isEmpty(): boolean {
    return this.#entries.length === 0;
  }

  get size(): number {
    return this.#entries.length;
  }

  /** @internal Called at the start of each validation run. */
  [clearErrors](): void {
    this.#entries = [];
  }
}
