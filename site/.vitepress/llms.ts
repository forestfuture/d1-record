import { readFileSync } from "node:fs";
import llmstxt from "vitepress-plugin-llms";

export const site = "https://docs.forestfuture.dev/d1-record";

/** The rules for agents, kept once in the agent skill (SKILL.md's "rules" region). */
function agentRules(): string {
  const skill = readFileSync(new URL("../../SKILL.md", import.meta.url), "utf8");
  const rules = /<!-- #region rules -->\n([\s\S]*?)<!-- #endregion rules -->/.exec(skill)?.[1];
  if (rules === undefined) throw new Error("SKILL.md has no rules region");
  return rules.trim();
}

/**
 * llms.txt, llms-full.txt and a Markdown copy of every page, for agents (llmstxt.org). Links are
 * absolute, and each page's `description` follows its link.
 */
export function llms() {
  return llmstxt({
    domain: "https://docs.forestfuture.dev",
    customLLMsTxtTemplate: `# d1-record

> A Rails-inspired Active Record for Cloudflare Workers and D1: models, validations, callbacks, associations and composable queries (\`@forestfuture/d1-record\`).

Each link below is a guide page as Markdown. The whole guide in one file: ${site}/llms-full.txt. The installed package ships the same file for its own version: \`node_modules/@forestfuture/d1-record/llms-full.txt\`.

## Rules

${agentRules()}

## Guide

{toc}

## Optional

- [Behavior contract](https://github.com/forestfuture/d1-record/blob/main/docs/contract.md): every rule the tests prove, tersely.
- [Agent skill](https://github.com/forestfuture/d1-record/blob/main/SKILL.md): install with \`npx skills add forestfuture/d1-record\`.
`,
  });
}
