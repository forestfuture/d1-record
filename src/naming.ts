/**
 * Converts a camelCase attribute name to its snake_case column name, treating
 * a run of capitals as one word (Rails' `underscore`): `htmlURL` → `html_url`,
 * `userID` → `user_id`, `sha256Hash` → `sha256_hash`.
 */
export function underscore(name: string): string {
  return name
    .replace(/([A-Z\d]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .toLowerCase();
}
