import { connect } from "@forestfuture/d1-record";
import { User } from "./models";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const db = connect(env.DB); // once per request

    if (request.method === "GET") {
      // One query for the users, and one for all their posts.
      const users = await db.model(User).includes("posts").order({ createdAt: "desc" }).toArray();
      return Response.json(users);
    }

    const { email } = await request.json<{ email: string }>();
    const user = db.model(User).build({ email });
    user.posts().build({ title: "Hello" }); // saved with the user, in one atomic batch
    if (!(await user.save())) {
      return Response.json({ errors: user.errors.fullMessages() }, { status: 422 });
    }
    return Response.json(user, { status: 201 });
  },
} satisfies ExportedHandler<Env>;
