import type { Errors } from "./errors-collection.ts";

export interface ValidationOptions {
  /** Not null, and not blank after trimming a string. */
  presence?: boolean;
}

/** One `validates(attribute, options)` declaration. */
export interface Validation {
  attribute: string;
  options: ValidationOptions;
}

function isBlank(value: unknown): boolean {
  return value === null || (typeof value === "string" && value.trim() === "");
}

/** Runs every validation in declaration order, adding failures to `errors`. */
export async function runValidations(
  validations: readonly Validation[],
  read: (attribute: string) => unknown,
  errors: Errors,
): Promise<void> {
  for (const { attribute, options } of validations) {
    if (options.presence && isBlank(read(attribute))) {
      errors.add(attribute, "can't be blank", { type: "blank" });
    }
  }
}
