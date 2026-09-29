// src/index.ts
import { connect } from "@forestfuture/d1-record";
import { User } from "./models";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const db = connect(env.DB);

    // GET: the 20 newest active users, each with their posts.
    if (request.method === "GET") {
      const users = await db
        .model(User)
        .active()
        .includes("posts") // loaded in one extra query, not one per user
        .order({ createdAt: "desc" })
        .limit(20)
        .toArray();
      return Response.json(users);
    }

    // POST: sign up a user with a first post, saved together.
    const { email } = await request.json<{ email: string }>();
    const user = db.model(User).build({ email });
    user.posts().build({ title: "Hello, D1" });

    // save() validates and runs callbacks; false means it wasn't saved, and why is in errors.
    if (!(await user.save())) {
      return Response.json({ errors: user.errors.fullMessages() }, { status: 422 });
    }
    return Response.json(user, { status: 201 });
  },
} satisfies ExportedHandler<Env>;
