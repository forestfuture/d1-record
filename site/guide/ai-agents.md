---
description: "Point coding agents at d1-record's docs, install its agent skill, and add its rules to your project's AGENTS.md or CLAUDE.md."
---

# AI agents

Coding agents follow d1-record’s conventions best with its guide at hand and its rules in context. Use any of these, or all three.

## Giving your agent the docs

| Resource                                                                 | What it is                                                                                                                                   |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [`llms.txt`](https://docs.forestfuture.dev/d1-record/llms.txt)           | An index of the guide, each page linked as Markdown, following [llmstxt.org](https://llmstxt.org). Start here when an agent can fetch pages. |
| [`llms-full.txt`](https://docs.forestfuture.dev/d1-record/llms-full.txt) | The whole guide in one Markdown file, about 20K tokens.                                                                                      |
| Any page + `.md`                                                         | Every page as Markdown: [`/guide/associations.md`](https://docs.forestfuture.dev/d1-record/guide/associations.md).                           |
| `node_modules/@forestfuture/d1-record/llms-full.txt`                     | The same guide, shipped in the package. It matches the version you’ve installed, and an agent can read it without fetching anything.         |

## Installing the agent skill

Install d1-record’s [agent skill](https://github.com/forestfuture/d1-record/blob/main/skills/d1-record/SKILL.md): its rules, the shapes of a Model and a Worker, and the mistakes to watch for, with pointers into the guide. Agents that support skills, such as Claude Code, Cursor, Codex, and [others](https://skills.sh), load it when they work on d1-record code:

```sh
npx skills add forestfuture/d1-record
```

To install the copy shipped with your installed version, sync skills from `node_modules`:

```sh
npx skills experimental_sync
```

::: warning TIP
The skills CLI marks `experimental_sync` as experimental, so its name may change.
:::

## Adding the rules to your project

Agents read `AGENTS.md`, or `CLAUDE.md` for Claude Code, at the start of every task. Paste this block into yours:

<<< @/../skills/d1-record/SKILL.md#rules{md}

Copy it again after upgrading d1-record, since the rules can change.
