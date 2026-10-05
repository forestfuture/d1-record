import { Model } from "@forestfuture/d1-record";

export class Account extends Model({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  handle: { type: "string", null: false },
  plan: "string",
  seats: "integer",
}) {}

export class Invitation extends Model({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  token: "string", // NULL once the invitation is accepted
  acceptedAt: "datetime",
}) {}

// #region destructure
export async function signUpFromJson(request: Request): Promise<Account> {
  // Name each field you take. The type argument is a claim, not a check: the values are
  // checked when they're assigned.
  const { email, handle } = await request.json<{ email: string; handle: string }>();
  return Account.create({ email, handle });
}
// #endregion destructure

// #region permit-json
export async function changePlan(account: Account, request: Request): Promise<Account> {
  // Only plan and seats can change here, whatever else the body holds.
  await account.update(Account.permit(await request.json(), "plan", "seats"));
  return account;
}
// #endregion permit-json

// #region permit-form
export async function signUp(request: Request): Promise<Response> {
  const form = await request.formData();
  const account = Account.build(Account.permit(form, "email", "handle"));
  if (!(await account.save())) {
    return Response.json({ errors: account.errors.fullMessages() }, { status: 422 });
  }
  return Response.json(account, { status: 201 });
}
// #endregion permit-form

// #region null-trap
export async function accept(request: Request): Promise<Response> {
  const { token } = await request.json<{ token: string }>();
  // {"token": null} would find an invitation that's already been accepted: its token is NULL.
  if (typeof token !== "string" || token === "") {
    return new Response("That invitation isn't valid", { status: 400 });
  }
  const invitation = await Invitation.findBy({ token });
  if (invitation === null) return new Response("That invitation isn't valid", { status: 404 });

  await invitation.update({ token: null, acceptedAt: new Date() });
  return new Response(`Welcome, ${invitation.email}`);
}
// #endregion null-trap
