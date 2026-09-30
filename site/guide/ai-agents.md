---
description: "Point coding agents at d1-record's docs, install its agent skill, and add its rules to your project's AGENTS.md or CLAUDE.md."
---

# Using d1-record with AI agents

Coding agents write better d1-record code when they have its documentation, and follow it most reliably when its key rules are in their context. There are three ways to give them both, from least to most effort.

## Give your agent the docs

| Resource                                                                 | What it is                                                                                                                                                                         |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`llms.txt`](https://docs.forestfuture.dev/d1-record/llms.txt)           | An index of the guide, each page linked as Markdown, following [llmstxt.org](https://llmstxt.org). Start here when an agent can fetch pages.                                       |
| [`llms-full.txt`](https://docs.forestfuture.dev/d1-record/llms-full.txt) | The whole guide in one Markdown file, about 20K tokens.                                                                                                                            |
| Any page + `.md`                                                         | Every page as Markdown: [`/guide/associations.md`](https://docs.forestfuture.dev/d1-record/guide/associations.md). The **Copy page** button at the top of each page copies it too. |
| `node_modules/@forestfuture/d1-record/llms-full.txt`                     | The same guide, shipped in the package. It matches the version you've installed, and an agent can read it without fetching anything.                                               |

## Install the agent skill

d1-record has an [agent skill](https://github.com/forestfuture/d1-record/blob/main/SKILL.md): its rules, the shapes of a Model and a Worker, and the mistakes to watch for, with pointers into the guide. Agents that support skills (Claude Code, Cursor, Codex and [others](https://skills.sh)) load it when they work on d1-record code.

```sh
npx skills add forestfuture/d1-record
```

The package ships the skill too, matching its version. To install it from `node_modules`:

```sh
npx skills experimental_sync
```

## Add the rules to your project

Agents read `AGENTS.md` (or `CLAUDE.md` for Claude Code) at the start of every task, so rules there are always in context. Paste this block into yours:

<<< @/../SKILL.md#rules{md}

The rules and the skill share one source, so this block is always the skill's current rules.
