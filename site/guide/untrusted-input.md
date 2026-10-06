---
description: "Permit only the fields you want from a request, return a 400 for values that can't be used, and check request values before you query with them."
---

# Handle untrusted input

A request can send any fields it likes. Pick the ones you want before they reach a Model.

## Permitting fields

Only permit the fields you want from a request:

<<< @/snippets/guide/untrusted-input.ts#permit{ts}

::: warning
`permit` can also read `FormData` or `URLSearchParams`.
:::

Permitted values are cast to their attribute's types, so `"42"` becomes `42` for an integer. [Models](./models#assigned-values-are-cast) lists what each type accepts.

::: tip Beyond Rails
Rails' `params.permit` only filters keys. d1-record's also casts each value, and checks that each name is an attribute.
:::

## Using a schema library

If you validate requests with a schema library such as [Zod](https://zod.dev) or [Valibot](https://valibot.dev), pass the parsed result to the Model:

```ts
import { z } from "zod";

const SignUp = z.object({ email: z.string(), handle: z.string().min(3) });

const fields = SignUp.parse(await request.json());
const account = await Account.create(fields);
```

## Returning a 400

A value that can't be cast throws a `TypeError`, and a body that isn't JSON throws a `SyntaxError`. Return a 400 for either:

<<< @/snippets/guide/untrusted-input.ts#bad-request{ts}

## Querying with request values

Check that a value is a string before you query with it. JSON can send `null`, and `findBy({ token: null })` matches rows whose token is NULL:

<<< @/snippets/guide/untrusted-input.ts#null-check{ts}

::: warning
A value that can't be cast matches nothing, so `whereNot({ id: "abc" })` excludes nothing.
:::
