/** `underscore` as it was written before #116: two regexes, quadratic on a long run of capitals. */
export function originalUnderscore(name: string): string {
  return name
    .replace(/([A-Z\d]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .toLowerCase();
}
