# d1-record

A Rails-inspired Active Record for [Cloudflare Workers](https://developers.cloudflare.com/workers/) and [D1](https://developers.cloudflare.com/d1/).

> **Status: in design and early development.** Not yet published to npm.

```ts
import { connect, Model } from "@forestfuture/d1-record";

export class User extends Model {
  static tableName = "users";
  // attributes, validations, scopes and associations…
}

export default {
  async fetch(request: Request, env: Env) {
    const db = connect(env.DB);
    const user = await db.model(User).find(42);
    return Response.json(user);
  },
};
```

## Design documents

- [`CONTEXT.md`](CONTEXT.md): the domain glossary (Model, Record, Relation, Scope, …).
- [`docs/contract.md`](docs/contract.md): the agreed public behavior, which the tests must prove.
- [`docs/adr/`](docs/adr/): architecture decisions and why they were made.
- [`docs/brief.md`](docs/brief.md): the build brief, updated to match the ADRs.

## Development

This project uses [Vite+](https://viteplus.dev) (`vp`) and pnpm.

```sh
vp install        # install dependencies (sets up git hooks)
vp check          # format, lint and type-check
vp test           # unit and integration tests (integration uses a real D1 via Miniflare)
vp pack           # build the library into dist/
```

## License

MIT
