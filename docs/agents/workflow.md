# Working on an issue

The process every issue in this repo follows, whoever or whatever picks it up. It has two **human checkpoints**. At both, the agent stops and waits, and never assumes approval.

The skills named below are in `.claude/skills/`. Claude Code loads them automatically. Other agents should read the named `SKILL.md` and follow it.

## 1. Orient

- Read the issue **and its comments**. Scope often moves between issues in comments ("moved here from #1").
- Read `CONTEXT.md` (use its terms), the `docs/contract.md` sections the issue names, and the ADRs in `docs/adr/` that touch the area.
- Check the current state: `vp install`, `vp check`, `vp test` should all pass before you change anything.

## 2. Agree the seams and open decisions — ✋ human checkpoint

Before writing any test, propose to the human, in one message:

- **The seams under test** (see the `tdd` skill). The default for this repo is the **public API against a real Miniflare D1**. Observe queries only through the public `onQuery` hook. There's no fake executor (ADR-0002). Type tests go in `tests/unit/`.
- **The build order**: the list of red → green slices you'll work through.
- **Open decisions**: anything the issue or contract leaves unsettled. Number each one, give a recommendation, and say why (the `grilling` skill's format). If a term is fuzzy or new, sharpen it with the `domain-modeling` skill: update `CONTEXT.md`, and offer an ADR only for decisions that are hard to reverse, surprising, and a real trade-off.

**Wait for the human's answers.** Postponed ideas become `deferred` issues, one per item, not notes in a comment.

## 3. Build test-first

Follow the `tdd` skill, one vertical slice at a time:

1. Write **one** failing test. Run it and confirm it fails for the expected reason (red).
2. Write the least code that makes it pass (green).
3. Run `vp check` (format, lint, types, complexity limits) and `vp test`. When a slice passes, **commit it** to `main` (repo convention), with a message saying what behavior was added.

Rules that matter here:

- Assert **results**, such as the records that come back. Assert SQL text only for safety properties (bound values, quoted identifiers). Assert query counts through `onQuery`.
- A test that passes on first run is a **guard**, not a red. Say so.
- If a size or complexity limit trips, split the code. Don't raise the limit.
- Keep `docs/contract.md` in sync with what you build. If you implement something differently from the contract, update it and tell the human.
- Add a changeset for a user-visible change (`vp exec changeset`, see `docs/agents/releasing.md`). While on 0.x, a breaking change is `minor` and anything else is `patch`.
- Update the documentation site's guide page for the behavior too (`site/guide/`). For a new page, or a page's structure, follow the `documentation-writer` skill: decide its Diátaxis type (tutorial, how-to, reference or explanation), audience and goal, and agree its outline with the human before writing. Its larger examples live in `site/snippets/`, where `vp check` type-checks them against the library, and each is shown with the imports its code uses (`site/.vitepress/examples.ts`; an inline example must import what it uses from the package); they also run against D1 in `tests/integration/site-examples.test.ts`, on their own schemas (`site/snippets/**/*.sql`).
- Scope changes (pulling work in from another issue, or pushing it out) get a comment on both issues.

## 4. Review

Run the `code-review` skill, with the commit before the issue's work as the fixed point and the issue as the spec. Present the Standards and Spec reports to the human, with a proposed fix for each finding. Fix what the human approves, each fix as its own red → green slice (or as a refactor, with tests staying green). Findings deferred on purpose go into issues or comments, not into silence.

**Security.** When the change touches SQL compilation, attribute assignment or conversion, code generation or file writing in the CLI, or CI and release, also run the `differential-review` skill over the same range, and present its findings as a third report. Write its report file outside the repo. The whole library gets a `security-review` before each release that changes those areas; each one adds a dated entry to the guide's Security page.

## 5. Finish — ✋ human checkpoint

- Full validation: `vp check`, `vp test`, `vp pack` (with attw and publint), `vp run check:public-types` (after `vp pack`: the published types expose no internals; mark internals `/** @internal */`), `vp run knip`, `vp run docs:build` (the site builds with no dead links). After a push to `main`, CI deploys the site once the checks pass (the Cloudflare tokens it uses are in [cloudflare-tokens.md](cloudflare-tokens.md)).
- **Never push without the human's approval.** Pushing over SSH may need the human to unlock their key. If a push fails with `agent refused operation`, ask them to run `git push` themselves.
- After the push, wait for CI to pass (`gh run watch`), then close the issue with a summary comment: what was delivered, the decisions made (link any `deferred` issues), and what the review found and fixed.

## Shortcut

The `implement` skill chains steps 3–4 (`tdd`, then `code-review`). This document adds the repo-specific parts around it: the checkpoints, the D1 seam, the contract, and closing the issue.
