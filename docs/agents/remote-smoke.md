# Remote D1 smoke suite

`tests/remote/` runs a handful of tests against a **real remote D1 database**, to catch what Miniflare's local D1 can't show: D1's error message formats (constraint translation parses them), `meta` fields, the 100-bound-parameter limit, and Sessions with bookmarks.

It connects through Wrangler's remote bindings (`getPlatformProxy` with a `remote: true` D1 binding), so the tests use the same `D1Database` binding API as a Worker. Each run creates its own tables with a unique prefix (`smoke_<time>_<random>_`), drops them when it finishes, and drops tables left behind by runs that crashed more than an hour ago.

Without the three environment variables below the suite is skipped, so `vp test` stays local.

## One-time setup (a human)

1. **A dedicated test database**, used for nothing else:
   ```sh
   pnpm dlx wrangler d1 create d1-record-smoke
   ```
   Note the `database_id` it prints. The name isn't used; the suite connects by id.
2. **Turn on read replication** for it, so the Session test proves read-your-writes: without replicas every read goes to the primary, and the test would pass whatever the library did. In the Cloudflare dashboard, open the database's **Settings** page and turn on **Read replication (Beta)**. (Or through the API: `PUT /accounts/{account_id}/d1/database/{database_id}` with `{"read_replication": {"mode": "auto"}}`.)
3. **An API token** (Cloudflare dashboard → My Profile → API Tokens → Create Custom Token), scoped to the one account, with:
   - Account → **D1** → Edit
   - Account → **Workers Scripts** → Edit (remote bindings run through a temporary edge-preview Worker)
   - The account needs a `workers.dev` subdomain, which edge previews use.
4. **Run it locally:**
   ```sh
   CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… D1_SMOKE_DATABASE_ID=… vp run test:remote
   ```
5. **In CI:** add `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` and `D1_SMOKE_DATABASE_ID` as repository secrets, then run the **Remote D1 smoke** workflow from the Actions tab. It only runs when started by hand (`workflow_dispatch`), never on push.

## When it fails

A failure here that doesn't happen in `vp test` is a difference between Miniflare and real D1. Fix the library, not the smoke test, and add an integration test for the behavior where Miniflare can show it.
