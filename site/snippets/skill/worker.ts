import { User } from "./models";

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "GET") {
      // One query for the users, and one for all their posts.
      const users = await User.includes("posts").order({ createdAt: "desc" }).toArray();
      return Response.json(users);
    }

    const { email } = await request.json<{ email: string }>();
    const user = User.build({ email });
    user.posts().build({ title: "Hello" }); // saved with the user, in one atomic batch
    if (!(await user.save())) {
      return Response.json({ errors: user.errors.fullMessages() }, { status: 422 });
    }
    return Response.json(user, { status: 201 });
  },
} satisfies ExportedHandler<Env>;
