# Cloudflare tokens and secrets

The repository's GitHub Actions use two Cloudflare API tokens, each with only the permissions its job needs. Create them in the Cloudflare dashboard under My Profile → API Tokens → **Create Custom Token**, scoped to the one account.

| GitHub secret               | Used by                                                                                         | Permissions                                                                                        | Resources                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`      | The remote D1 smoke suite: `vp run test:remote`, and the **Remote D1 smoke** workflow (by hand) | Account → **D1** → Edit<br>Account → **Workers Scripts** → Edit                                    | The account                                       |
| `CLOUDFLARE_DOCS_API_TOKEN` | The documentation deploy: the `docs` job in `ci.yml`, on pushes to `main`                       | Account → **Workers Scripts** → Edit<br>Zone → **Workers Routes** → Edit<br>Zone → **Zone** → Read | The account, and the zone `forestfuture.dev` only |

Both workflows also need these secrets, which aren't tokens:

| GitHub secret           | Value                                                                        |
| ----------------------- | ---------------------------------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID` | The account ID, from the account's Workers & Pages overview page             |
| `D1_SMOKE_DATABASE_ID`  | The `d1-record-smoke` database's ID (see [remote-smoke.md](remote-smoke.md)) |

## Why each permission

- **D1 → Edit**: the smoke suite creates, writes and reads its tables in `d1-record-smoke`.
- **Workers Scripts → Edit**:
  - Smoke token: Wrangler's remote bindings run through a temporary preview Worker, so the account also needs a `workers.dev` subdomain.
  - Docs token: it creates and updates the `d1-record-docs` Worker and uploads the site's files.
- **Workers Routes → Edit**: attaches the route `docs.forestfuture.dev/d1-record*` to that Worker (`site/wrangler.jsonc`).
- **Zone → Read**: the route names its zone by name (`forestfuture.dev`), and Wrangler looks up the zone's ID.

**User → User Details → Read** isn't needed. Wrangler only prints a warning without it, and leaving it out gives Wrangler less to print when something fails. Actions logs are readable by anyone who can see the repository.

## Replacing a token

1. Create the new token with the permissions above.
2. Update the secret with `gh secret set CLOUDFLARE_DOCS_API_TOKEN` (or `CLOUDFLARE_API_TOKEN`). It prompts for the value, so the token never appears in your shell history.
3. Delete the old token in the dashboard.

A token that has expired, or lacks a permission, fails with `Authentication error [code: 10000]`.
