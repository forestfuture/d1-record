# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase. This is a single-context repo: one glossary and one ADR folder, both at the root.

## Before exploring, read these

- **`GLOSSARY.md`**: the project's terms.
- **`docs/adr/`**: the ADRs that touch the area you're about to work in.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (sharpen it with the `domain-modeling` skill).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (attributes declared once via the Model factory), but worth reopening because…_
