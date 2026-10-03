import { Model, type Database } from "@forestfuture/d1-record";

// #region user
export class User extends Model({
  id: { type: "string", null: false, default: () => crypto.randomUUID() },
  email: { type: "string", null: false },
  isActive: "boolean",
  bio: "string", // added by 0002_add_bio_to_users.sql
  createdAt: "datetime",
  updatedAt: "datetime",
}) {}
// #endregion user

export async function writeBio(db: Database, email: string) {
  // #region use
  const user = await db.model(User).createOrThrow({ email, bio: "Writes about D1" });
  // #endregion use
  return user;
}
