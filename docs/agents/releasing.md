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

The release jobs in `.github/workflows/ci.yml` run on `main`, after `check` passes:

1. **`release-mode`** works out what to do. With changesets waiting, it's `version`. With a version in `package.json` that npm doesn't have yet, it's `publish`.
2. **`release-version`** opens or updates the **Version Packages** pull request. That pull request bumps `package.json`, writes `CHANGELOG.md` and deletes the used changesets. Pull requests opened by Actions don't run CI, but merging one runs CI on `main` before anything is published.
3. **`release-pack`** builds (`vp pack`) and packs the tarball.
4. **`release-publish`** publishes it to npm with provenance, tags the commit with the version and creates a GitHub Release with its changelog. It's the only job that can get an OIDC token (`id-token: write`).

To release, merge the Version Packages pull request.

## One-time setup

These are done once, in this order.

1. **Allow Actions to open pull requests:** Settings → Actions → General → Workflow permissions → **Allow GitHub Actions to create and approve pull requests** (the organization may need to allow it first).
2. **Make the repository public.** npm only attaches provenance to packages published from a public repository.
3. **The first release uses a temporary token**, because npm only lets a trusted publisher be set on a package that already exists:
   1. On npmjs.com: avatar → Access Tokens → Generate New Token → **Granular Access Token**. Name it `d1-record first release`, with the shortest expiry. Give it Read and write for the `@forestfuture` scope, and no organization access. Tick "Bypass two-factor authentication" if offered: CI can't answer a 2FA prompt.
   2. `gh secret set NPM_TOKEN`, and paste the token when it asks.
   3. Update the "Not on npm yet" warning in `site/guide/getting-started.md` in the Version Packages pull request, then merge it. CI publishes `0.1.0`.
4. **Then switch to trusted publishing:**
   1. On npmjs.com, the package's Settings → **Trusted Publisher** → GitHub Actions: organization `forestfuture`, repository `d1-record`, workflow `ci.yml`, no environment.
   2. Delete the secret (`gh secret delete NPM_TOKEN`) and the token on npmjs.com.
   3. In the package's Settings → Publishing access, choose **Require two-factor authentication and disallow tokens**.
   4. In the `forestfuture` organization's settings, require 2FA for members.

From then on, only CI in `forestfuture/d1-record`, from `ci.yml`, can publish.
