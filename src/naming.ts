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

/** A snake_case name as a camelCase attribute: `api_key` → `apiKey`. */
function camelize(name: string): string {
  return name.replace(/_([a-z\d])/g, (_, letter: string) => letter.toUpperCase());
}

/**
 * An association's foreign key attribute when none is given, by Rails' convention: a
 * belongsTo's name + `Id` (`author` → `authorId`); for a hasMany or hasOne, the owner's class
 * name + `Id` (`User` → `userId`, `APIKey` → `apiKeyId`). `inferredFrom` says which, for errors.
 */
export function inferForeignKey(
  kind: "belongsTo" | "hasMany" | "hasOne",
  associationName: string,
  ownerName: string,
): { foreignKey: string; inferredFrom: string } {
  return kind === "belongsTo"
    ? {
        foreignKey: `${associationName}Id`,
        inferredFrom: `the association name ${associationName}`,
      }
    : {
        foreignKey: `${camelize(underscore(ownerName))}Id`,
        inferredFrom: `the class name ${ownerName}`,
      };
}
