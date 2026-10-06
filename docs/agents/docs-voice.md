# Docs voice

The guide reads like Laravel's documentation: friendly, direct, and quick to scan. The `documentation-writer` skill decides a page's structure (its Diátaxis type, audience and outline). This page decides how its sentences read.

## Rules

- **Open with what the reader does, or what the feature does,** in one sentence. No preamble about why, and no "This page covers…".
- **Assume a competent developer.** Show what to do. Leave out what not to do, and warnings about obvious misuse.
- **Page titles are nouns** ("Validations", "Logging", "Untrusted input"), as Laravel's are; the sidebar uses the same words.
- **Section headings name the task, with a gerund:** "Permitting fields", "Defining scopes".
- **Introduce each example with one sentence ending in a colon,** then show it.
- **Keep examples short.** One idea per line: name an intermediate value rather than nesting calls.
- **Write to "you", in plain words.** Short sentences, one idea each.
- **Present options as refinements:** "By default, …", "If you want …, …".
- **Put side facts in an amber box titled TIP** (`::: warning TIP`) rather than in the main flow. A real warning gets a `::: warning` box with its own title ("Uniqueness isn't a guarantee"). Differences from Rails go in their own `::: tip Beyond Rails` (or `Compared with Rails`) box.
- **Explain why only when a default would surprise.** The library's internals stay out of the guide.
- **Use the Oxford comma** in every list of three or more: “narrows, orders, or pages”, “`save`, `update`, and `destroy`”.
- **Use smart quotes and apostrophes in prose** (“ ” ‘ ’), never straight ones (" '), in the guide, the README and the sidebar. Code, inline code, URLs and front matter keep straight quotes, since there they're syntax.
- **Cut** hedges, restatements, "Note that", sentences chained with colons, and summaries of what was just shown.

## Before and after

Before:

> TypeScript's types stop at the edge of your Worker. `await request.json<{ email: string }>()` doesn't check the body: it tells TypeScript what to assume. The body can hold any keys and any values, and so can a form or a query string. This page covers how to let only the values you mean into your records and queries.
>
> ## Take only the fields you mean to
>
> Passing a whole body to a Model lets the sender set any attribute: `Account.create(await request.json())` saves an `isAdmin` or a `plan` if the body has one. This is mass assignment. Name the fields you take instead.

After:

> ## Permitting fields
>
> Only permit the fields you want from a request:
>
> ```ts
> const permitted = Account.permit(await request.json(), "email", "handle");
> const account = await Account.create(permitted);
> ```
>
> ::: warning TIP
> `permit` can also read `FormData` or `URLSearchParams`.
> :::
