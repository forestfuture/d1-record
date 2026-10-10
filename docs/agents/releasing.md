# Releasing

Versions and the changelog are managed with [Changesets](https://changesets.dev), and CI publishes to npm. Nothing is published by an ordinary commit to `main`: the **Version Packages** pull request is the gate.

## Day to day: add a changeset

Every user-visible change (new behavior, a fix, a breaking change, a deprecation) comes with a changeset, committed with the change:

```sh
vp exec changeset
```

Or write the file by hand in `.changeset/` (any name ending in `.md`):

```md
---
"@forestfuture/d1-record": patch
---

`findBy` accepts a comparison, as `where` does.
```

The line is for the library's users: say what changed for them, not how. Internal changes (tests, refactors, docs for contributors, CI) need no changeset.

**Which bump, while on 0.x:** a breaking change is `minor` (0.1.x → 0.2.0), and a feature or a fix is `patch`. `major` is for 1.0. npm's `^0.1.0` ranges never take a new minor, so users only get breaking changes when they choose to.

## What CI does

The release jobs in `.github/workflows/ci.yml` run on `main`, after `check` passes, one run at a time:

1. **`release-mode`** works out what to do:
   - `version` while changesets are waiting;
   - `publish` once `package.json` has a version npm doesn't have yet;
   - `none` otherwise, which is what most pushes hit.
2. **`release-version`** opens or updates the **Version Packages** pull request. That pull request bumps `package.json`, writes `CHANGELOG.md` (formatted with `vp fmt`) and deletes the used changesets. CI rewrites its branch on every push to `main`, so don't edit it by hand. Pull requests opened by Actions don't run CI, but merging one runs CI on `main` before anything is published.
3. **`release-pack`** packs the tarball. Packing runs the package's `prepack` script, which builds `dist/` with `vp pack` (attw and publint included), then the docs site, and copies its `llms-full.txt` into the package. So a docs build that fails, a dead link included, blocks the release.
4. **`release-publish`** publishes the tarball to npm with provenance, tags the commit with the version, and creates a GitHub Release with its changelog. It's the only job that can get an OIDC token (`id-token: write`). Changesets publishes with pnpm, so provenance is turned on with `PNPM_CONFIG_PROVENANCE`: pnpm ignores `NPM_CONFIG_*`.

To release, merge the Version Packages pull request.

## One-time setup

These are done once, in this order.

1. **Allow Actions to open pull requests.** In the `forestfuture` organization's settings, then in the repository's: Settings → Actions → General → Workflow permissions → **Allow GitHub Actions to create and approve pull requests**. Both have to allow it.
2. **Make the repository public.** npm only attaches provenance to packages published from a public repository.
3. **Edit anything that says the package isn't published yet**, in a pull request to `main`: the "Not on npm yet" warning in `site/guide/getting-started.md`.
4. **The first release used a temporary token**, because npm only lets a trusted publisher be set on a package that already exists. `0.1.0` went out this way on 2026-10-10: a granular access token named `d1-record first release` (Read and write for the `@forestfuture` scope, the shortest expiry, "Bypass two-factor authentication" ticked), stored with `gh secret set NPM_TOKEN`, and written to `~/.npmrc` by a step in `release-publish` that has since been removed. If a publish fails because pnpm tried trusted publishing first (an OIDC or token-exchange error), nothing was published: delete the tag and release if they were created, then re-run the failed `release-publish` job.
5. **Then switch to trusted publishing:**
   1. On npmjs.com, the package's Settings → **Trusted Publisher** → GitHub Actions: organization `forestfuture`, repository `d1-record`, workflow `ci.yml`, no environment.
   2. Delete the secret (`gh secret delete NPM_TOKEN`) and the token on npmjs.com.
   3. In the package's Settings → Publishing access, choose **Require two-factor authentication and disallow tokens**.
   4. In the `forestfuture` organization's settings, require 2FA for members.
6. **Check each release for provenance.** The package page on npmjs.com shows a provenance badge linking to the commit, and the version has `dist.attestations`. `0.1.0` has none (#109), so confirm the first release published with no token has one.

From then on, only CI in `forestfuture/d1-record`, from `ci.yml`, can publish.

## After the first release: help agents find it

1. **Install the skill once** to check it works for others: `npx skills add forestfuture/d1-record`. skills.sh has no submission: a skill appears there from install counts, which the skills CLI reports for public GitHub repositories.
2. **Ask to be listed under Databases** (https://www.skills.sh/topic/databases) once it has some installs. Topics look curated by hand, so ask the skills.sh team, for example in an issue on `vercel-labs/skills`.
3. **Add the docs to Context7** (https://context7.com), which indexes `llms.txt` for coding agents: submit `https://docs.forestfuture.dev/d1-record/llms.txt`.
