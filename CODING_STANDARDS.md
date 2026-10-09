# Coding standards

Judgement calls the `code-review` skill's Standards axis checks, beyond what `vp check` enforces and what `CONTRIBUTING.md` and `docs/agents/docs-voice.md` state. Anything a tool can check belongs in a check, not here.

## Tests

- **A test's name reads as a sentence after its `describe`**, and says only what that example shows. Read "describe › test" aloud. Under `describe("none() with no database")`, write "finders and counts answer", not "answers without one": the `describe` already says it. A name stands alone, so no "so do…" or "too" leaning on a sibling.
- **Assert results**, such as the records that come back. Assert SQL text only for safety properties, and query counts through `onQuery`.
- **One behavior per test.** A second `await` of a different Model in the same test, or a `DELETE` between assertions, means two tests.
- **A test that passes on first run is a guard.** Say so in the commit body.

## Names and comments

- A module's first line says what it owns (lint enforces it); update it when the module gains a responsibility.
- Extract a dense pipeline into a named helper instead of casting through it.
