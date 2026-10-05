---
description: "Take only the fields you mean to from a request (destructuring, Model.permit or a schema validator), answer a value that can't be used with a 400, and keep a null from a request from matching the wrong row."
---

# Handle untrusted input

TypeScript's types stop at the edge of your Worker. `await request.json<{ email: string }>()` doesn't check the body: it tells TypeScript what to assume. The body can hold any keys and any values, and so can a form or a query string. This page covers how to let only the values you mean into your records and queries.

## Take only the fields you mean to

Passing a whole body to a Model lets the sender set any attribute: `Account.create(await request.json())` saves an `isAdmin` or a `plan` if the body has one. This is mass assignment. Name the fields you take instead.

The plainest way is to destructure them:

<<< @/snippets/guide/untrusted-input.ts#destructure{ts}

Or let the Model pick them out with `permit`, as Rails' `params.permit` does. It keeps the attributes you name, drops every other key, and casts each value as assigning it would, so its result is what its type says. It goes straight into `build`, `create` or `update`:

<<< @/snippets/guide/untrusted-input.ts#permit-json{ts}

`permit` reads a form (`FormData`) or a query string (`URLSearchParams`) too. A key that appears more than once takes its last value, as in Rails:

<<< @/snippets/guide/untrusted-input.ts#permit-form{ts}

`permit` reads only the input's own keys, and refuses a name that isn't an attribute; [Models](./models#picking-attributes-from-input-permit) has its full rules.

::: tip Beyond Rails
Rails' `permit` filters keys, and keeps only scalar values. d1-record's knows the Model, so it also checks the names you give it, and casts each value to its attribute's type: `{"isAdmin": "false"}` gives `isAdmin: false`, never a truthy string that TypeScript calls a boolean.
:::

## Or validate with a schema

A schema library such as [Zod](https://zod.dev) or [Valibot](https://valibot.dev) does both jobs at once: it drops the keys the schema doesn't name, and it checks each value's type and format. Its result is safe to pass to a Model:

```ts
import { z } from "zod";

const SignUp = z.object({ email: z.string(), handle: z.string().min(3) }); // other keys are dropped

const account = await Account.create(SignUp.parse(await request.json()));
```

## Return a 400 for a value that can't be used

Whichever way you take the fields, d1-record checks each value as it's assigned, and [casts](./models#assigned-values-are-cast) it to the attribute's type: `"false"` is `false` for a boolean, and `"42"` is `42` for an integer. A value that can't be cast, such as `"no"` for a boolean, throws `TypeError`, and so does `permit` given something that isn't an object, a form or a query string. Those mean the request is wrong, so answer with a 400, as you would for a body that isn't JSON:

<<< @/snippets/guide/untrusted-input.ts#bad-request{ts}

A value of the right type can still be one the user shouldn't send, so choosing the fields stays your job, and so do [validations](./validations), which answer with a 422.

## Untrusted values in conditions

Conditions are cast the same way, and a value that can't be cast matches nothing. One value needs care: `null`. `where({ token: null })` means `token IS NULL`, and JSON can send `null` as easily as a string. Here an invitation's token is set to `NULL` once the invitation is accepted, so `{"token": null}` would find an accepted invitation. Check that the value is what you expect before you query with it:

<<< @/snippets/guide/untrusted-input.ts#null-trap{ts}

An array is a list of values, and `[null]` matches `NULL` too, so the same check covers it.

Excluding by an untrusted value needs the same care, the other way round. A value that can't be cast matches nothing, so `whereNot({ id: "abc" })` excludes nothing and matches every row.

## Checklist

- Never pass a whole body, form or query string to a Model: take named fields, with destructuring, `permit` or a schema.
- Leave out attributes the user shouldn't set (`role`, `plan`, `isAdmin`), even when the form you wrote doesn't send them.
- Before querying with a value from a request, check its type, especially for tokens and secrets, where `null` would match the wrong row.
- Treat a `TypeError` from an assignment as a bad request (400), not a server error.
- Validate formats and ranges with [validations](./validations): casting checks types, not meaning.
