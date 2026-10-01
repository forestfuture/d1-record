/**
 * English pluralization, ported from Active Support's default inflections
 * (activesupport/lib/active_support/inflections.rb), so tables are named as Rails names them.
 */

/** Rules in Rails' order of definition. The last one that matches wins, as in Rails. */
const RULES: readonly (readonly [RegExp, string])[] = [
  [/$/, "s"],
  [/s$/i, "s"],
  [/^(ax|test)is$/i, "$1es"],
  [/(octop|vir)us$/i, "$1i"],
  [/(octop|vir)i$/i, "$1i"],
  [/(alias|status)$/i, "$1es"],
  [/(bu)s$/i, "$1ses"],
  [/(buffal|tomat)o$/i, "$1oes"],
  [/([ti])um$/i, "$1a"],
  [/([ti])a$/i, "$1a"],
  [/sis$/i, "ses"],
  [/(?:([^f])fe|([lr])f)$/i, "$1$2ves"],
  [/(hive)$/i, "$1s"],
  [/([^aeiouy]|qu)y$/i, "$1ies"],
  [/(x|ch|ss|sh)$/i, "$1es"],
  [/(matr|vert|ind)(?:ix|ex)$/i, "$1ices"],
  [/^(m|l)ouse$/i, "$1ice"],
  [/^(m|l)ice$/i, "$1ice"],
  [/^(ox)$/i, "$1en"],
  [/^(oxen)$/i, "$1"],
  [/(quiz)$/i, "$1zes"],
  ...irregular("person", "people"),
  ...irregular("man", "men"),
  ...irregular("child", "children"),
  ...irregular("sex", "sexes"),
  ...irregular("move", "moves"),
  ...irregular("zombie", "zombies"),
];

/** Words with no plural, matched as the last word (Rails' `\b<word>\z`). */
const UNCOUNTABLE =
  /\b(?:equipment|information|rice|money|species|series|fish|sheep|jeans|police)$/i;

/** Rails' `irregular`: rules for the singular and the plural, keeping the first letter's case. */
function irregular(singular: string, plural: string): (readonly [RegExp, string])[] {
  return [
    [new RegExp(`(${singular[0]})${singular.slice(1)}$`, "i"), `$1${plural.slice(1)}`],
    [new RegExp(`(${plural[0]})${plural.slice(1)}$`, "i"), `$1${plural.slice(1)}`],
  ];
}

/** Rails' `pluralize`: `category` → `categories`, `person` → `people`, `sheep` → `sheep`. */
export function pluralize(word: string): string {
  if (word === "" || UNCOUNTABLE.test(word)) return word;
  for (let index = RULES.length - 1; index >= 0; index--) {
    const [pattern, replacement] = RULES[index]!;
    if (pattern.test(word)) return word.replace(pattern, replacement);
  }
  return word;
}
