---
description: "What d1-record protects against and what's left to your app, the guarantees its tests check, how its supply chain is set up, and a log of the security reviews it has had."
---

# Security

d1-record sits between the requests your Worker receives and the database that holds your users’ data: whatever a request sends can reach a query or a record through it. A mistake there is a mistake in every app that uses it. This page explains what d1-record protects against, what it leaves to your app, which tests check each guarantee, how releases are built, and the security reviews it has had.

These are the project’s own reviews, not an independent audit. Each says what it covered and what it didn’t.

## What d1-record protects against

- **SQL injection.** Every value is bound as a parameter, never written into SQL text. Identifiers come only from a Model’s declared attributes, and are quoted. Raw SQL is only possible through the `sql` tagged template, which binds every value it’s given.
- **Values that aren’t what TypeScript says.** A value from JSON, a form or a query string is cast to its attribute’s type when it’s assigned or used in a condition, and anything ambiguous is refused: `"false"` can’t save `true`. See [Models](./models#assigned-values-are-cast).
- **Prototype pollution and inherited names.** Attributes and associations are looked up only by the Model’s own names, so `__proto__`, `constructor` and other names every object has are unknown names, and `Object.prototype` is never written to.
- **Secrets in logs and errors.** Values of attributes named like passwords, tokens, keys and emails are hidden from `onQuery` listeners and from error messages. See [Logging](./logging#keep-secrets-out-of-the-logs).
- **One request’s data reaching another.** Nothing about a request (a D1 Session, a listener) is ever stored on a Model class. See [Database resolution](./query-databases).
- **Denial of service through parsing.** The patterns that read numbers and dates are linear, so a long value can’t use up a Worker’s CPU time.

## What’s left to your app

- **Choosing which fields a request may set.** Never pass a whole body to a Model: use `permit`, destructuring or a schema. See [Untrusted input](./untrusted-input).
- **An untrusted `null` in a condition.** `findBy({ token: null })` matches rows whose token is NULL. Check a value’s type before querying with it.
- **Authorization.** Whether this user may read or change this record is your app’s decision.
- **Formats and ranges.** Casting checks types, not meaning: use [validations](./validations).
- **Secrets inside `sql` fragments.** A fragment’s values have no attribute, so they’re not hidden from listeners.

## Guarantees, and the tests that check them

The library’s guarantees are tested against a real D1 database (through Miniflare), and CI’s by a test that reads its workflows. CI runs every test on every change.

| Guarantee                                                                      | Tests                                                                                                                  |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Values are bound, identifiers are quoted, and plain strings are refused as SQL | [`sql-safety`](https://github.com/forestfuture/d1-record/blob/main/tests/integration/sql-safety.test.ts)               |
| Assigned and condition values are cast, or refused, in linear time             | [`attribute-casting`](https://github.com/forestfuture/d1-record/blob/main/tests/integration/attribute-casting.test.ts) |
| Only a Model’s own names are attributes or associations                        | [`name-lookups`](https://github.com/forestfuture/d1-record/blob/main/tests/integration/name-lookups.test.ts)           |
| `permit` keeps only the named attributes, reading own keys only                | [`permit`](https://github.com/forestfuture/d1-record/blob/main/tests/integration/permit.test.ts)                       |
| Filtered attributes’ values never reach listeners or errors                    | [`filter-attributes`](https://github.com/forestfuture/d1-record/blob/main/tests/integration/filter-attributes.test.ts) |
| A request’s database stays with that request                                   | [`current-database`](https://github.com/forestfuture/d1-record/blob/main/tests/integration/current-database.test.ts)   |
| CI’s actions are pinned, and release jobs run no install scripts               | [`ci-workflows`](https://github.com/forestfuture/d1-record/blob/main/tests/unit/ci-workflows.test.ts)                  |

## Supply chain

- **No runtime dependencies.** Installing `@forestfuture/d1-record` installs only d1-record’s own code, so no other package’s compromise can reach your Worker through it.
- **Releases are built by CI.** The npm package is built and published by the repository’s release workflow, never from a laptop, so what’s on npm is what’s in the repository. The first release sets up npm’s trusted publishing and provenance, so each version can be traced to the commit and workflow that built it.
- **CI is pinned.** Every third-party GitHub Action is pinned to a commit, not a tag that could be moved, because a moved tag would run someone else’s code in the job that publishes. A test fails if one isn’t.
- **Release jobs run no install scripts.** The jobs that decide, build, version and publish a release install dependencies without running their install scripts and without a shared cache, so a compromised development dependency can’t change what’s built or published.
- **Dependencies are watched.** Dependabot proposes updates weekly, waiting a week after each release, since a compromised release is usually caught within days. `pnpm audit` is part of each security review.

## Review log

Each security review adds an entry here: what it covered, how, what it found, and what it didn’t cover.

### 2026-10-04: the library, its command line, and CI

**Scope:** the library (`src/`), the command line (`cli/`), the CI and release workflows, and the development dependencies.

**Method:**

- a security review of the whole codebase with Sentry’s `security-review` skill (OWASP-based), briefed on a library’s risks: what happens when an app passes untrusted input into it;
- untrusted inputs probed against a real D1 database: prototype keys, wrong types, `null`, long values;
- a dependency audit with Trail of Bits’ `supply-chain-risk-auditor` and `pnpm audit`;
- each fix then reviewed with Trail of Bits’ `differential-review`.

**Findings, all fixed:**

| Severity | Finding                                                                                   | Issue                                                      |
| -------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| High     | Assigned values weren’t checked at runtime: `"false"` saved as `true` for a boolean       | [#81](https://github.com/forestfuture/d1-record/issues/81) |
| High     | The publish job used actions pinned by movable tags, and ran install scripts              | [#80](https://github.com/forestfuture/d1-record/issues/80) |
| High     | Found while fixing #81: a pattern that backtracked on long numbers (ReDoS)                | [#81](https://github.com/forestfuture/d1-record/issues/81) |
| Medium   | No protection against mass assignment, and no guidance on an untrusted `null`             | [#82](https://github.com/forestfuture/d1-record/issues/82) |
| Medium   | Bound values, secrets included, reached `onQuery` listeners and errors                    | [#83](https://github.com/forestfuture/d1-record/issues/83) |
| Low      | Inherited names (`constructor`, `__proto__`) caused errors instead of being unknown names | [#84](https://github.com/forestfuture/d1-record/issues/84) |
| Low      | Development dependency advisories, and unescaped config values in generated code          | [#85](https://github.com/forestfuture/d1-record/issues/85) |

**Not covered:** the source of the third-party Actions at their pinned commits; D1 and workerd themselves; isolation between concurrent requests beyond the existing tests; apps’ own code.

## Reporting a vulnerability

Please report a security problem privately, as the [security policy](https://github.com/forestfuture/.github/blob/main/SECURITY.md) describes, never in a public issue.
