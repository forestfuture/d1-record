// `record.errors`: the validation failures a record collects.
import {
  humanAttributeName,
  messageOf,
  type ErrorEntry,
  type MessageSource,
} from "./error-messages.ts";
import { inspectCustom, printed, type Inspect, type InspectOptions } from "./inspect-support.ts";

/** One validation failure: which attribute (or `"base"`), what kind, and the message. */
export interface ValidationError {
  attribute: string;
  type: string;
  message: string;
}

/** @internal The library's key for emptying an errors collection. */
export const clearErrors = Symbol("clearErrors");

/** @internal The library's key for adding an entry whose message is looked up when it's read. */
export const addEntry = Symbol("addEntry");

/** A record's validation errors: `record.errors`. Cleared at the start of each validation run. */
export class Errors {
  #entries: ErrorEntry[] = [];
  readonly #source: MessageSource | undefined;

  /** @internal Made by the library for each record. */
  constructor(source?: MessageSource) {
    this.#source = source;
  }

  /** Adds an error; `type` defaults to `"invalid"`. Use `"base"` for the record as a whole. */
  add(attribute: string, message: string, options: { type?: string } = {}): void {
    this.#entries.push({ attribute, type: options.type ?? "invalid", values: {}, message });
  }

  /** The messages for one attribute (always an array). */
  get(attribute: string): string[] {
    return this.#entries
      .filter((entry) => entry.attribute === attribute)
      .map((entry) => messageOf(this.#source, entry));
  }

  /** Every message with its attribute's display name first: "Email can't be blank". */
  fullMessages(): string[] {
    return this.#entries.map((entry) => {
      const message = messageOf(this.#source, entry);
      if (entry.attribute === "base") return message;
      return `${humanAttributeName(this.#source?.model, entry.attribute)} ${message}`;
    });
  }

  /** Every error as `{ attribute, type, message }` (copies). */
  toArray(): ValidationError[] {
    return this.#entries.map((entry) => ({
      attribute: entry.attribute,
      type: entry.type,
      message: messageOf(this.#source, entry),
    }));
  }

  isEmpty(): boolean {
    return this.#entries.length === 0;
  }

  get size(): number {
    return this.#entries.length;
  }

  /** `Errors [ { attribute, type, message }, … ]`, so a console shows what `#entries` holds (#104). */
  [inspectCustom](depth: number, options: InspectOptions, inspect: Inspect): string {
    return printed("Errors", "Errors", () => this.toArray(), { depth, options, inspect });
  }

  /** @internal Adds an error the library found, such as a validator's. */
  [addEntry](entry: ErrorEntry): void {
    this.#entries.push(entry);
  }

  /** @internal Called at the start of each validation run. */
  [clearErrors](): void {
    this.#entries = [];
  }
}
