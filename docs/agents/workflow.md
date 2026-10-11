# Working on an issue

The process every issue in this repo follows, whoever or whatever picks it up. It has two **human checkpoints**. At both, the agent stops and waits, and never assumes approval.

The skills named below are in `.claude/skills/`. Claude Code loads them automatically. Other agents should read the named `SKILL.md` and follow it.

## 1. Orient

- Read the issue **and its comments**. Scope often moves between issues in comments ("moved here from #1").
- Read `GLOSSARY.md` (use its terms), the `docs/contract.md` sections the issue names, and the ADRs in `docs/adr/` that touch the area.
- Check the current state: `vp install`, `vp check`, `vp test` should all pass before you change anything.

## 2. Agree the seams and open decisions — ✋ human checkpoint

Before writing any test, propose to the human, in one message:

- **The seams under test** (see the `tdd` skill). The default for this repo is the **public API against a real Miniflare D1**. Observe queries only through the public `onQuery` hook. There's no fake executor (ADR-0002). Type tests go in `tests/unit/`. To write an integration test, copy the setup in `tests/integration/to-sql.test.ts`: `createTestDatabase` from `tests/support/d1.ts`, an `onQuery` events array, and `order({ email: "asc" })` / `where({ ... })` taking objects (plain strings throw).
- **The build order**: the list of red → green slices you'll work through.
- **The docs outline**, for each guide page or section the change touches: its four answers (Diátaxis type, audience, goal, scope) and an outline, so the human approves them with the seams. The `documentation-writer` skill runs in step 3, when the copy is written.
- **Open decisions**: anything the issue or contract leaves unsettled. Number each one, give a recommendation, and say why (the `grilling` skill's format). If a term is fuzzy or new, sharpen it with the `domain-modeling` skill: update `GLOSSARY.md`, and offer an ADR only for decisions that are hard to reverse, surprising, and a real trade-off.

**Wait for the human's answers.** Postponed ideas become `deferred` issues, one per item, not notes in a comment.

## 3. Build test-first

Follow the `tdd` skill, one vertical slice at a time:

1. Write **one** failing test. Run it and confirm it fails for the expected reason (red). A red test that opens a console, a server or a process waits out its timeout, so run it with `--bail 1 --test-timeout 20000` and raise the timeout only once it is green.
2. Write the least code that makes it pass (green).
3. Run `vp check --fix` (format, lint, types, complexity limits) and `vp test`. Without `--fix`, a formatting error hides the lint errors, and the pre-commit hook then rejects the commit. `src/relation.ts` and `src/model.ts` sit at the 500-line cap, so adding to either means moving code to another module in the same commit. When a slice passes, **commit it** on the issue's branch, named `<issue>-<slug>` (`main` takes pull requests only), with a message saying what behavior was added (see [Commit messages](#commit-messages)).

### Commit messages

- **Title**: aim for 50 characters (the `commit-msg` hook warns past 60 and rejects past 72; a few over is fine). Imperative, capitalized, no trailing period, no `feat:`-style prefixes. End with the issue number: `(#82)`.
- **Body**, after a blank line: what behavior changed and why, in a few short lines or bullets wrapped at 72. The detail goes here, not in the title.

```text
Tidy permit's docs, types and tests (#82)

- validates gets its doc comment back
- permit's comment mentions forms and query strings
- One Permitted type replaces the variants
- Tests: a misspelled name is a compile error, and
  a modelFor base class has permit
```

Rules that matter here:

- Assert **results**, such as the records that come back. Assert SQL text only for safety properties (bound values, quoted identifiers). Assert query counts through `onQuery`.
- A test that passes on first run is a **guard**, not a red. Say so.
- Behavior that depends on a **terminal** (typing, a paste, Ctrl-C or Ctrl-D, colors, a prompt) is checked in a `tests/integration/*-pty.test.ts` through `tests/support/pty.ts`, which plays steps at a real pseudo-terminal. Piped streams can't show it: a paste reaches a process a line at a time, and typing triggers completion. Write one-off terminal scripts there instead of in a scratch folder.
- If a size or complexity limit trips, split the code. Don't raise the limit.
- When a change falsifies a claim ("local only", "never", "only", "alone"), grep the guide, README, help text, ADRs, glossary and changeset for that **stale claim** before the docs commit.
- Update everything a public change touches, as listed in [CONTRIBUTING.md](../../CONTRIBUTING.md#what-a-public-change-touches): the contract, glossary, guide page, exports, `SKILL.md`, README, changeset, and any ADR. If you implement something differently from the contract, update it and tell the human. While on 0.x, a changeset for a breaking change is `minor` and anything else is `patch` (`vp exec changeset`, see `docs/agents/releasing.md`).
- Guide copy (`site/guide/`), new or changed: run the `documentation-writer` skill before writing any of it, working to the outline agreed in step 2 (that approval stands; the skill needn't ask again). Write its sentences in the guide's voice ([docs-voice.md](docs-voice.md)). Its larger examples live in `site/snippets/`, where `vp check` type-checks them against the library, and each is shown with the imports its code uses (`site/.vitepress/examples.ts`; an inline example must import what it uses from the package); they also run against D1 in `tests/integration/site-examples.test.ts`, on their own schemas (`site/snippets/**/*.sql`).
- Scope changes (pulling work in from another issue, or pushing it out) get a comment on both issues.

## 4. Review

Run the `code-review` skill, with `main` (the branch's merge-base) as the fixed point and the issue as the spec. The standards sources are `CONTRIBUTING.md`, `CODING_STANDARDS.md` and [docs-voice.md](docs-voice.md). Commits from before the pull-request flow sit inside older ranges, so for those, give both reviewers the issue's own commits (`git log --grep='(#N)'`) and tell them to ignore the rest. Present the Standards and Spec reports to the human, with a proposed fix for each finding. Fix what the human approves, each fix as its own red → green slice (or as a refactor, with tests staying green). Findings deferred on purpose go into issues or comments, not into silence.

**Security.** When the change touches SQL compilation, attribute assignment or conversion, code generation or file writing in the CLI, or CI and release, also run the `differential-review` skill over the same range, and present its findings as a third report. Write its report file outside the repo. The whole library gets a `security-review` before each release that changes those areas; each one adds a dated entry to the guide's Security page.

## 5. Finish — ✋ human checkpoint

- Full validation: `vp run validate` runs these in CI's order and prints one line per step (the failing step's output after it): `vp check`, `vp run coverage` (`vp test` with a branch-coverage floor, set in `vite.config.ts`), `vp pack` (with attw and publint), `vp run check:public-types` (after `vp pack`: the published types expose no internals; mark internals `/** @internal */`), `vp run knip`, `vp run docs:build` (the site builds with no dead links), `vp run check:package`. After a merge to `main`, CI deploys the site once the checks pass (the Cloudflare tokens it uses are in [cloudflare-tokens.md](cloudflare-tokens.md)).
- **Never push or merge without the human's approval.** Pushing over SSH may need the human to unlock their key. If a push fails with `agent refused operation`, ask them to run `git push` themselves.
- Push the branch and open a pull request that says `Closes #<issue>`, with its body written by the `pr` skill. `main` allows a pull request only, merged by rebase once `check` passes.
- After the merge, wait for CI on `main` to pass (`gh run watch`), then close the issue with a summary comment (if `Closes` didn't): what was delivered, the decisions made (link any `deferred` issues), and what the review found and fixed.
- The human may then run `/retro` on the session. It suggests changes to the agent's environment (checks, standards, steering files), not to the code.

## Shortcuts

The `implement` skill chains steps 3–4 (`tdd`, then `code-review`). This document adds the repo-specific parts around it: the checkpoints, the D1 seam, the contract, and closing the issue.

For a parent issue with sub-issues, the human can run `/implement-spec` instead. It builds the sub-issues in parallel worktrees and merges them onto one integration branch. Agree the seams and open decisions for each sub-issue first (step 2), and treat opening and merging the pull request from the integration branch like a push: only with the human's approval.
