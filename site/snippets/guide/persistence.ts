import { connect, RecordInvalid } from "@forestfuture/d1-record";
import { User } from "../getting-started/models";

export async function examples(env: Env): Promise<Response> {
  const db = connect(env.DB);
  // #region save
  const user = db.model(User).build({ email: "ada@example.com" });
  if (await user.save()) {
    // saved: user.isPersisted() is true
  } else {
    console.log(user.errors.fullMessages()); // ["Email has already been taken"]
  }

  const created = await db.model(User).create({ email: "grace@example.com" }); // saved, or not
  await created.update({ isActive: false }); // true or false
  // #endregion save

  // #region or-throw
  try {
    const grace = await db.model(User).createOrThrow({ email: "grace@example.com" });
    await grace.updateOrThrow({ isActive: true });
  } catch (error) {
    if (error instanceof RecordInvalid) {
      return Response.json({ errors: error.record.errors.fullMessages() }, { status: 422 });
    }
    throw error; // anything else is a real failure
  }
  // #endregion or-throw

  // #region destroy
  const destroyed = await created.destroy(); // the record, or false if a callback aborted
  if (destroyed) {
    destroyed.isDestroyed(); // true: readable, but can't be changed or saved
  }
  // #endregion destroy

  // #region reload
  const fresh = await db.model(User).find(user.id);
  fresh.email = "changed@example.com";
  await fresh.reload(); // back to what D1 holds
  // #endregion reload
  return Response.json(fresh);
}
